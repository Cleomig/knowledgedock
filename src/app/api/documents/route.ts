import { NextResponse } from "next/server";
import { getAiProvider } from "@/lib/ai";
import { query, execute } from "@/lib/db";

/** GET /api/documents — Lista documentos del usuario (owner_id = 'anonymous' para MVP) */
export async function GET() {
  try {
    const owner = process.env.DEFAULT_OWNER_ID ?? "anonymous";
    const rows = await query<Record<string, unknown>>(
      `SELECT id, title, mime_type, storage_key, created_at
       FROM documents
       WHERE owner_id = $1
       ORDER BY created_at DESC`,
      [owner]
    );
    return NextResponse.json({ documents: rows as any[] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: msg } }, { status: 500 });
  }
}

/** POST /api/documents — Sube e indexa un documento */
export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const title = (formData.get("title") as string) || file?.name || "Sin título";
    const owner = process.env.DEFAULT_OWNER_ID ?? "anonymous";

    if (!file) {
      return NextResponse.json({ error: { code: "MISSING_FILE", message: "Falta el archivo" } }, { status: 400 });
    }

    const mimeType = file.type || "application/octet-stream";
    const buffer = Buffer.from(await file.arrayBuffer());

    // Extracción de texto según tipo
    let text: string;
    if (mimeType === "application/pdf") {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { extractPdfText } = require("@/lib/chunking");
      text = await extractPdfText(buffer) ?? "";
    } else if (mimeType.startsWith("text/")) {
      text = buffer.toString("utf-8");
    } else {
      return NextResponse.json({ error: { code: "UNSUPPORTED_TYPE", message: `Tipo MIME no soportado: ${mimeType}` } }, { status: 400 });
    }

    if (!text || text.trim().length === 0) {
      return NextResponse.json({ error: { code: "EMPTY_CONTENT", message: "El documento no contiene texto extraíble" } }, { status: 400 });
    }

    // Guardar referencia (en MVP no usamos R2, solo storage_key como placeholder)
    const storageKey = `docs/${owner}/${crypto.randomUUID()}`;
    const docResult = await query<Record<string, unknown>>(
      `INSERT INTO documents (owner_id, title, mime_type, storage_key)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [owner, title, mimeType, storageKey]
    );
    const docId = (docResult[0] as any)?.id;
    if (!docId) throw new Error("No se pudo crear el documento");

    // Chunking
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { chunkText } = require("@/lib/chunking");
    const chunks = chunkText(text);

    if (chunks.length === 0) {
      return NextResponse.json({ error: { code: "NO_CHUNKS", message: "El documento no produjo chunks" } }, { status: 400 });
    }

    // Embedding en lote
    const provider = getAiProvider();
    const embeddings = await provider.embedBatch(chunks, {
      taskType: "retrieval_document",
    });

    // Insertar chunks con embeddings
    for (let i = 0; i < chunks.length; i++) {
      await execute(
        `INSERT INTO chunks (document_id, ord, content, embedding)
         VALUES ($1, $2, $3, $4)`,
        [docId, i, chunks[i], JSON.stringify(embeddings[i].vector)]
      );
    }

    return NextResponse.json({
      id: docId,
      title,
      mimeType,
      chunksCreated: chunks.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: msg } }, { status: 500 });
  }
}
