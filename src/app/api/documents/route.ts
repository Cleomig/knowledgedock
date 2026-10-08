import { NextResponse } from "next/server";
import { getAiProvider } from "@/lib/ai";
import { query, execute } from "@/lib/db";
import { getAuthenticatedUser, unauthorizedResponse } from "@/lib/auth-session";

/** Fila de `documents` tal y como la devuelve el SELECT de abajo. */
interface DocumentRow {
  id: string;
  title: string;
  mime_type: string;
  created_at: Date | string;
}

/** GET /api/documents — Lista únicamente los documentos del usuario autenticado. */
export async function GET(req: Request) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return unauthorizedResponse();

    const rows = await query<DocumentRow>(
      `SELECT id, title, mime_type, created_at
       FROM documents
       WHERE owner_id = $1
       ORDER BY created_at DESC`,
      [user.id]
    );
    return NextResponse.json({ documents: rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: msg } }, { status: 500 });
  }
}

/** POST /api/documents — Sube e indexa un documento */
export async function POST(req: Request) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return unauthorizedResponse();

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const title = (formData.get("title") as string) || file?.name || "Sin título";

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

    // Los originales se procesan en memoria; storage_key queda sin uso y nullable.
    const docResult = await query<{ id: string }>(
      `INSERT INTO documents (owner_id, title, mime_type)
       VALUES ($1, $2, $3) RETURNING id`,
      [user.id, title, mimeType]
    );
    const docId = docResult[0]?.id;
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
