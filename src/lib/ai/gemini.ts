import { generateText, streamText, embed, embedMany } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type {
  AiProvider,
  ChatMessage,
  ChatResult,
  ChatStream,
  EmbeddingOptions,
  EmbeddingResult,
} from "./types";
import { toPrompt } from "./prompt";
import { FIRST_CHUNK_TIMEOUT_MS, withIdleTimeout } from "./idle-timeout";

/**
 * Dimensión efectiva de los vectores.
 *
 * `gemini-embedding-001` devuelve 3072 por defecto, pero acepta
 * `outputDimensionality` para recortar. Fijamos 768 porque es el
 * `vector(768)` de db/schema.sql — sin esto la BD rechaza los INSERT.
 * 768 además reduce el tamaño del índice HNSW y la latencia de búsqueda.
 */
export const EMBEDDING_DIMENSIONS = 768;

/** Mapea el taskType neutral del dominio al enum en mayúsculas de Google. */
const GOOGLE_TASK_TYPE = {
  retrieval_query: "RETRIEVAL_QUERY",
  retrieval_document: "RETRIEVAL_DOCUMENT",
} as const;

/**
 * Modelos de respaldo, en orden, para cuando el primario falla.
 *
 * Dos motivos reales, ambos medidos en producción:
 *
 * 1. La cuota gratuita es POR MODELO (20 req/día) y cada modelo tiene su
 *    propio cubo: si el primario se agota, el siguiente sigue funcionando.
 * 2. Gemini devuelve 503 "This model is currently experiencing high demand"
 *    en picos, aunque los reintentos del SDK agoten. Probar el modelo
 *    siguiente convierte un fallo transitorio en una respuesta.
 *
 * `gemini-flash-latest` NO va aquí: es alias de `gemini-3.8-flash` y comparte
 * su cubo agotado. Los `gemini-2.5-*` tampoco: dan 404 para cuentas nuevas.
 */
const FALLBACK_CHAT_MODELS = [
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
];

export class GeminiProvider implements AiProvider {
  private apiKey: string;
  /**
   * Modelos de chat en orden de prioridad: el primero es el configurado y
   * el resto entran solo si el anterior falla antes de emitir texto.
   */
  private chatModels: string[];
  private embeddingModel: string;
  /**
   * Instancia configurada del SDK.
   *
   * Importante: el export `google` por defecto solo lee
   * `GOOGLE_GENERATIVE_AI_API_KEY` del entorno, por lo que nuestro
   * `GEMINI_API_KEY` quedaría ignorado y el SDK lanzaría
   * "API key is missing". Creamos la instancia pasando la key explícita.
   */
  private sdk: ReturnType<typeof createGoogleGenerativeAI>;

  constructor(env: NodeJS.ProcessEnv) {
    this.apiKey = env.GEMINI_API_KEY ?? "";
    const primary = env.GEMINI_CHAT_MODEL ?? "gemini-3.7-flash";
    this.chatModels = [
      primary,
      ...FALLBACK_CHAT_MODELS.filter((m) => m !== primary),
    ];
    this.embeddingModel = env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-001";

    if (!this.apiKey) {
      throw new Error(
        "GEMINI_API_KEY is required for GeminiProvider. Set it in .env."
      );
    }

    this.sdk = createGoogleGenerativeAI({ apiKey: this.apiKey });
  }

  /** Opciones de embedding compartidas por embed() y embedBatch(). */
  private embeddingProviderOptions(options?: EmbeddingOptions) {
    return {
      google: {
        outputDimensionality: EMBEDDING_DIMENSIONS,
        ...(options?.taskType
          ? { taskType: GOOGLE_TASK_TYPE[options.taskType] }
          : {}),
      },
    };
  }

  async chat(messages: ChatMessage[], _options?: { stream?: boolean }): Promise<ChatResult> {
    const { instructions, messages: rest } = toPrompt(messages);

    let lastError: unknown = null;
    for (const model of this.chatModels) {
      try {
        const result = await generateText({
          model: this.sdk.languageModel(model),
          // Ver `maxRetries` en `streamText`: reintentar el mismo modelo es
          // más lento y menos fiable que pasar al siguiente.
          maxRetries: 0,
          ...(instructions ? { instructions } : {}),
          messages: rest,
        });
        // Un texto vacío es un fallo encubierto: seguimos con el siguiente.
        if (result.text) return { text: result.text };
        lastError = new Error(`${model} no devolvió texto`);
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError ?? new Error("Ningún modelo de chat disponible");
  }

  async streamChat(messages: ChatMessage[]): Promise<ChatStream> {
    const { instructions, messages: rest } = toPrompt(messages);
    const { sdk, chatModels: candidates } = this;

    /**
     * Devuelve un único stream de texto que va probando modelos hasta que
     * alguno arranque de verdad.
     *
     * El orden importa: solo cambiamos de modelo ANTES de emitir el primer
     * trozo. Una vez que hay texto en pantalla, cambiar a mitad de frase
     * produciría una respuesta mezclada de dos modelos.
     */
    async function* textStream(): AsyncGenerator<string> {
      let lastError: unknown = null;

      for (const model of candidates) {
        let failure: unknown = null;
        let emitted = false;

        // Todo dentro del try: si `streamText` lanza síncrono (p. ej. modelo
        // desconocido) también debe probarse el siguiente, no escapar del bucle.
        try {
          const result = streamText({
            model: sdk.languageModel(model),
            /**
             * Cero reintentos por modelo.
             *
             * El SDK reintenta solo con backoff exponencial: medido el
             * 2026-10-08, 3 intentos tardaban ~17-23 s POR MODELO. Con cuatro
             * candidatos eso son hasta 90 s antes de llegar al primero sano,
             * y el tope del consumidor (45 s) se imponía mucho antes: el
             * usuario veía un error en vez de la respuesta que sí estaba a
             * un salto de distancia.
             *
             * El diseño ya apostaba por el siguiente modelo ("aunque los
             * reintentos del SDK agoten"), solo que no se le daba prisa.
             */
            maxRetries: 0,
            ...(instructions ? { instructions } : {}),
            messages: rest,
            onError: (event) => {
              // El SDK de AI registra el error por consola pero NO rechaza el
              // iterable: el stream "termina" limpio y vacío. Sin capturarlo
              // aquí, /api/ask emitiría [done] con la respuesta en blanco y el
              // usuario jamás vería cuál fue la causa real.
              failure = event.error;
            },
          });

          const iterator = result.textStream[Symbol.asyncIterator]();

          // Saltamos trozos vacíos: solo cuentan si llega texto de verdad.
          //
          // Con tope, porque el silencio NO dispara `onError`: si el modelo no
          // llega a emitir nada, `await iterator.next()` se quedaría esperando
          // y el `for (const model of candidates)` de arriba nunca probaría el
          // siguiente. Un modelo mudo debe FALLAR y ceder el turno.
          let step = await withIdleTimeout(
            iterator.next(),
            FIRST_CHUNK_TIMEOUT_MS
          );
          while (!step.done && step.value === "") {
            step = await withIdleTimeout(
              iterator.next(),
              FIRST_CHUNK_TIMEOUT_MS
            );
          }

          if (step.done || failure !== null) {
            lastError = failure ?? new Error(`${model} no devolvió texto`);
            continue;
          }

          emitted = true;
          yield step.value;

          for (;;) {
            const next = await iterator.next();
            if (next.done) break;
            yield next.value;
          }

          if (failure !== null) throw failure;
          return;
        } catch (err) {
          // Ya se mostró parte de la respuesta: no hay vuelta atrás.
          if (emitted) throw err;
          lastError = err;
        }
      }

      throw lastError ?? new Error("Ningún modelo de chat disponible");
    }

    return { textStream: textStream() };
  }

  async embed(text: string, options?: EmbeddingOptions): Promise<EmbeddingResult> {
    const { embedding } = await embed({
      model: this.sdk.embedding(this.embeddingModel),
      value: text,
      providerOptions: this.embeddingProviderOptions(options),
    });

    return { vector: embedding };
  }

  async embedBatch(
    texts: string[],
    options?: EmbeddingOptions
  ): Promise<EmbeddingResult[]> {
    const batchSize = 50;
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      let attempt = 0;
      let success = false;

      while (!success && attempt < 2) {
        try {
          const { embeddings } = await embedMany({
            model: this.sdk.embedding(this.embeddingModel),
            values: batch,
            providerOptions: this.embeddingProviderOptions(options),
          });
          allEmbeddings.push(...embeddings);
          success = true;
        } catch (error) {
          attempt++;
          if (attempt >= 2) {
            const msg = error instanceof Error ? error.message : String(error);
            throw new Error(`Falló el lote de embeddings (textos ${i} a ${i + batch.length - 1}) tras reintentar: ${msg}`);
          }
        }
      }
    }

    return allEmbeddings.map((v) => ({ vector: v }));
  }
}
