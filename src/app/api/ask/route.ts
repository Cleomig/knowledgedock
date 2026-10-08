import { NextResponse } from "next/server";
import { getAiProvider } from "@/lib/ai";
import { query, execute } from "@/lib/db";

/** POST /api/ask — Streaming */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { question, documents }: { question: string; documents?: { id: string; content: string }[] } = body;

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
    const rows = await query<Record<string, unknown>>(
      `SELECT c.content, c.ord, d.title, d.id as doc_id,
        1 - (c.embedding <=> $1::vector) AS similarity
       FROM chunks c
       JOIN documents d ON d.id = c.document_id
       ORDER BY c.embedding <=> $1::vector
       LIMIT 5`,
      [JSON.stringify(questionEmbedding)]
    );

    const relevantChunks: { content: string; ord: number; title: string; doc_id: string; similarity: number }[] =
      (rows as any[]) ?? [];

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
        controller.enqueue(encoder.encode("data: [context]\n\n"));
        for (const chunk of relevantChunks) {
          const payload = JSON.stringify({
            type: "citation",
            index: relevantChunks.indexOf(chunk) + 1,
            source: chunk.title,
            content: chunk.content,
          });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [start]\n\n"));

        // Si la generación falla, NO emitimos [done]: un cliente que solo
        // mira el final del stream daría por buena una respuesta vacía.
        let failed = false;
        try {
          for await (const textPart of stream.textStream) {
            controller.enqueue(encoder.encode(`data: ${textPart}\n\n`));
          }
        } catch (err) {
          failed = true;
          const msg = err instanceof Error ? err.message : String(err);
          const payload = JSON.stringify({ type: "error", message: msg });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
          controller.enqueue(encoder.encode(`data: [error: ${msg}]\n\n`));
        }

        if (!failed) {
          controller.enqueue(encoder.encode("data: [done]\n\n"));
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
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: msg } }, { status: 500 });
  }
}
