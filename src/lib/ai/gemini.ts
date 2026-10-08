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

export class GeminiProvider implements AiProvider {
  private apiKey: string;
  private chatModel: string;
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
    // gemini-2.0-flash y 2.5-flash ya no estan disponibles para usuarios nuevos; 3.8-flash es el actual.
    this.chatModel = env.GEMINI_CHAT_MODEL ?? "gemini-3.8-flash";
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

  async chat(messages: ChatMessage[], options?: { stream?: boolean }): Promise<ChatResult> {
    const { instructions, messages: rest } = toPrompt(messages);

    const result = await generateText({
      model: this.sdk.languageModel(this.chatModel),
      ...(instructions ? { instructions } : {}),
      messages: rest,
    });

    return { text: result.text };
  }

  async streamChat(messages: ChatMessage[]): Promise<ChatStream> {
    const { instructions, messages: rest } = toPrompt(messages);

    const result = streamText({
      model: this.sdk.languageModel(this.chatModel),
      ...(instructions ? { instructions } : {}),
      messages: rest,
    });

    return { textStream: result.textStream };
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
    const { embeddings } = await embedMany({
      model: this.sdk.embedding(this.embeddingModel),
      values: texts,
      providerOptions: this.embeddingProviderOptions(options),
    });

    return embeddings.map((v) => ({ vector: v }));
  }
}
