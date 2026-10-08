import { NextResponse } from "next/server";
import { getAiProvider } from "@/lib/ai";
import { humanError } from "@/lib/ai/errors";
import { STREAM_IDLE_TIMEOUT_MS, withIdleTimeout } from "@/lib/ai/idle-timeout";
import { query } from "@/lib/db";
import { getAuthenticatedUser, unauthorizedResponse } from "@/lib/auth-session";

/**
 * Segundos máximos de ejecución de esta función en Vercel.
 *
 * Debe ser MAYOR que `STREAM_IDLE_TIMEOUT_MS`: si la plataforma cortara el
 * stream antes, el cliente vería morir la conexión en mitad de la respuesta
 * en lugar del `[error: ...]` que emitimos nosotros, que es el que pinta un
 * mensaje comprensible en pantalla.
 */
export const maxDuration = 60;

/** POST /api/ask — Streaming */

/** Un chunk recuperado por similitud, tal y como lo devuelve la SQL de abajo. */
interface ChunkHit {
  content: string;
  ord: number;
  title: string;
  doc_id: string;
  similarity: number;
}

/** POST /api/ask — Streaming */
export async function POST(req: Request) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return unauthorizedResponse();

    const body = await req.json();
    const { question }: { question: string } = body;

    if (!question || typeof question !== "string") {
      return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "question es requerido" } }, { status: 400 });
    }

    // Obtener chunks relevantes para esta pregunta
    const provider = getAiProvider();

    // Embedder de la pregunta
    const { vector: questionEmbedding } = await provider.embed(question, {
      taskType: "retrieval_query",
    });

    // Buscar top-5 chunks más similares
    const relevantChunks = await query<ChunkHit>(
      `SELECT c.content, c.ord, d.title, d.id as doc_id,
        1 - (c.embedding <=> $1::vector) AS similarity
       FROM chunks c
       JOIN documents d ON d.id = c.document_id
       WHERE d.owner_id = $2
       ORDER BY c.embedding <=> $1::vector
       LIMIT 5`,
      [JSON.stringify(questionEmbedding), user.id]
    );

    // Construir contexto con citas
    const contextBlocks = relevantChunks
      .map((c, i) => `[${i + 1}] (${c.title}, chunk ${c.ord + 1}, sim=${c.similarity.toFixed(3)}):\n${c.content}`)
      .join("\n\n");

    const systemPrompt = `Eres un asistente de KnowledgeDock. Responde la pregunta del usuario usando SOLO la información de los documentos proporcionados.
Cita tus respuestas usando el formato [n] donde n es el número de la cita.
Si la información no está en los documentos, di honestamente que no lo sabes.
Mantén la respuesta concisa y relevante.
Alinea cada cita con el texto fuente exacto.`;

    // La generación pasa por la abstracción igual que los embeddings.
    // Antes se instanciaba `google("gemini-2.0-flash")` a mano: ese modelo
    // ya no existe (404) y además el export por defecto del SDK no recibe
    // GEMINI_API_KEY, así que la ruta fallaba aunque la key fuera válida.
    const stream = await provider.streamChat([
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Documentos relevantes:\n${contextBlocks || "(No se encontraron documentos relevantes)"}\n\nPregunta: ${question}`,
      },
    ]);

    // Convertir stream de texto a SSE
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        /**
         * SSE obliga a que cada `data:` sea UNA sola línea: un `\n` dentro
         * del payload parte el evento y el receptor descarta la continuación
         * (le llega como línea sin prefijo `data:`). El texto del modelo trae
         * saltos de línea reales, así que aquí lo repartimos en tantas líneas
         * `data:` como haga falta; el cliente las vuelve a unir con `\n`.
         */
        const send = (payload: string) => {
          for (const line of payload.split("\n")) {
            controller.enqueue(encoder.encode(`data: ${line}\n`));
          }
          controller.enqueue(encoder.encode("\n"));
        };

        send("[context]");
        for (const chunk of relevantChunks) {
          const payload = JSON.stringify({
            type: "citation",
            index: relevantChunks.indexOf(chunk) + 1,
            source: chunk.title,
            content: chunk.content,
          });
          send(payload);
        }
        send("[start]");

        // Si la generación falla, NO emitimos [done]: un cliente que solo
        // mira el final del stream daría por buena una respuesta vacía.
        let failed = false;
        let emitted = 0;
        try {
          // Iteración manual en vez de `for await`: solo así podemos poner un
          // tope a cada trozo. Un `for await` espera indefinidamente y basta
          // con que el proveedor deje de emitir para que el SSE se quede abierto
          // para siempre.
          const iterator = stream.textStream[Symbol.asyncIterator]();

          for (;;) {
            const { done, value: textPart } = await withIdleTimeout(
              iterator.next(),
              STREAM_IDLE_TIMEOUT_MS
            );
            if (done) break;
            emitted += textPart.length;
            send(textPart);
          }
          // El SDK de AI registra algunos fallos sin rechazar el iterable:
          // el stream "termina" limpio y sin texto. Sin este guard, [done] se
          // emite igual, el cliente pinta las citas con la respuesta en
          // blanco y jamás se ve que hubo un error. GeminiProvider ya captura
          // esos fallos y re-lanza el motivo real; esto queda como red de
          // seguridad para cualquier otro proveedor.
          if (emitted === 0) {
            throw new Error(
              "El proveedor IA no devolvió ningún texto. Suele deberse a cuota agotada o a que el modelo no está disponible."
            );
          }
        } catch (err) {
          failed = true;
          const msg = humanError(err);
          const payload = JSON.stringify({ type: "error", message: msg });
          send(payload);
          send(`[error: ${msg}]`);
        }

        if (!failed) {
          send("[done]");
        }
        controller.close();
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: humanError(err) } },
      { status: 500 }
    );
  }
}
