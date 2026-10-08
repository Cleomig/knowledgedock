import { NextResponse } from "next/server";
import { getAiProvider } from "@/lib/ai";
import { query } from "@/lib/db";

/** POST /api/search — Búsqueda semántica */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    // Umbral por defecto: 0.7 quedaba por encima de lo que realmente produce
    // `gemini-embedding-001` (medido entre 0.63 y 0.66 en consultas reales),
    // de modo que la búsqueda devolvía siempre una lista vacía. 0.5 sigue
    // descartando ruido sin vaciar los resultados. Es configurable por request.
    const { query: searchQuery, threshold = 0.5 }: { query: string; threshold?: number } = body;

    if (!searchQuery || typeof searchQuery !== "string") {
      return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "query es requerido" } }, { status: 400 });
    }

    const provider = getAiProvider();
    const { vector } = await provider.embed(searchQuery, {
      taskType: "retrieval_query",
    });

    // HNSW cosine similarity search (1 - cosine_distance)
    const rows = await query<Record<string, unknown>>(
      `SELECT c.content, c.ord, d.id as document_id, d.title,
        1 - (c.embedding <=> $1::vector) AS similarity
       FROM chunks c
       JOIN documents d ON d.id = c.document_id
       WHERE 1 - (c.embedding <=> $1::vector) >= $2
       ORDER BY similarity DESC
       LIMIT 10`,
      [JSON.stringify(vector), threshold]
    );

    return NextResponse.json({
      query: searchQuery,
      results: (rows as any[]).map((r) => ({
        content: r.content,
        ord: r.ord,
        documentId: r.document_id,
        title: r.title,
        similarity: parseFloat((r.similarity as string) ?? "0"),
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: msg } }, { status: 500 });
  }
}
