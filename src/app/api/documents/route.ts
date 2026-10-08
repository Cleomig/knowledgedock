import { NextResponse } from "next/server";
import { after } from "next/server";
import { getAiProvider } from "@/lib/ai";
import { query, execute } from "@/lib/db";
import { getAuthenticatedUser, unauthorizedResponse } from "@/lib/auth-session";
import { sendDocumentEmail } from "@/lib/email";
// Import estático (no `require`): `require` con alias `@/` no se resuelve en
// el entorno de tests de Vitest, y estos módulos son baratos (pdf-parse ya se
// carga de forma perezosa dentro de `extractPdfText`).
import { chunkText, extractPdfText } from "@/lib/chunking";
import { extractDocxText } from "@/lib/docx";
import { summarizeDocument } from "@/lib/summarize";

/** Fila de `documents` tal y como la devuelve el SELECT de abajo. */
interface DocumentRow {
  id: string;
  title: string;
  mime_type: string;
  created_at: Date | string;
  status: string;
  error: string | null;
  summary: string | null;
}

/**
 * Envía un email de aviso si el usuario tiene notificaciones activadas.
 * Best-effort: cualquier error se traga para no romper el procesamiento.
 */
async function maybeSendEmail(
  userId: string,
  title: string,
  status: "ready" | "failed",
  summary: string | null,
  error: string | null
): Promise<void> {
  try {
    const rows = await query<{ email: string; notify_email: boolean }>(
      `SELECT email, notify_email FROM "user" WHERE id = $1`,
      [userId]
    );
    const row = rows[0];
    if (!row || !row.notify_email || !row.email) return;

    await sendDocumentEmail({
      to: row.email,
      title,
      status,
      summary,
      error,
    });
  } catch (err) {
    console.error("[email] Error sending notification:", err instanceof Error ? err.message : String(err));
  }
}

/** GET /api/documents — Lista únicamente los documentos del usuario autenticado. */
export async function GET(req: Request) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return unauthorizedResponse();

    // Transición anti-stuck: cualquier fila con status='processing' y created_at > 5 minutos -> 'failed'
    await execute(
      `UPDATE documents 
       SET status = 'failed', error = 'Procesamiento agotado'
       WHERE owner_id = $1 
       AND status = 'processing' 
       AND created_at < NOW() - INTERVAL '5 minutes'`,
      [user.id]
    );

    const rows = await query<DocumentRow>(
      `SELECT id, title, mime_type, created_at, status, error, summary
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

export const maxDuration = 60;

/** POST /api/documents — Sube e indexa un documento (ingesta asíncrona) */
export async function POST(req: Request) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return unauthorizedResponse();

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const title = (formData.get("title") as string) || file?.name || "Sin título";

    // Validaciones baratas que se mantienen en línea
    if (!file) {
      return NextResponse.json({ error: { code: "MISSING_FILE", message: "Falta el archivo" } }, { status: 400 });
    }

    if (file.size > 4 * 1024 * 1024) {
      return NextResponse.json({ error: { code: "MAX_FILE_SIZE", message: "Archivo demasiado grande" } }, { status: 413 });
    }

    const mimeType = file.type || "application/octet-stream";
    const buffer = Buffer.from(await file.arrayBuffer());

    // Validación de tipo MIME
    if (
      mimeType !== "application/pdf" &&
      mimeType !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document" &&
      !mimeType.startsWith("text/") &&
      !file.name.toLowerCase().endsWith(".docx")
    ) {
      return NextResponse.json({ error: { code: "UNSUPPORTED_TYPE", message: `Tipo MIME no soportado: ${mimeType}` } }, { status: 400 });
    }

    // INSERT del documento con status 'processing'
    const docResult = await query<{ id: string }>(
      `INSERT INTO documents (owner_id, title, mime_type, status)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [user.id, title, mimeType, 'processing']
    );
    const docId = docResult[0]?.id;
    if (!docId) throw new Error("No se pudo crear el documento");

    // Responder inmediatamente con 202 Accepted
    const immediateResponse = {
      id: docId,
      title,
      mimeType,
      status: 'processing' as const
    };

    // Programar trabajo pesado para después de la respuesta
    after(async () => {
      try {
        let text: string;
        
        // Extracción de texto según tipo
        if (mimeType === "application/pdf") {
          text = await extractPdfText(buffer) ?? "";
        } else if (
          mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
          file.name.toLowerCase().endsWith(".docx")
        ) {
          text = await extractDocxText(buffer) ?? "";
        } else if (mimeType.startsWith("text/")) {
          text = buffer.toString("utf-8");
        } else {
          // No debería llegar aquí por la validación anterior, pero por seguridad
          throw new Error(`Tipo MIME no soportado: ${mimeType}`);
        }

        // Validar que el texto no esté vacío después de la extracción
        if (!text || text.trim().length === 0) {
          await execute(
            `UPDATE documents SET status = 'failed', error = $2 WHERE id = $1`,
            [docId, 'El documento no contiene texto extraíble']
          );
          await maybeSendEmail(user.id, title, "failed", null, "El documento no contiene texto extraíble");
          return;
        }

        // Chunking
        const chunks = chunkText(text);

        if (chunks.length === 0) {
          await execute(
            `UPDATE documents SET status = 'failed', error = $2 WHERE id = $1`,
            [docId, 'El documento no produjo chunks']
          );
          await maybeSendEmail(user.id, title, "failed", null, "El documento no produjo chunks");
          return;
        }

        // Embedding en lote
        const provider = getAiProvider();
        const embeddings = await provider.embedBatch(chunks, {
          taskType: "retrieval_document",
        });

        // Insertar chunks con embeddings
        const ords = chunks.map((_c: string, i: number) => i);
        const contents = chunks;
        const vectors = embeddings.map((e: { vector: number[] }) => JSON.stringify(e.vector));

        await execute(
          `INSERT INTO chunks (document_id, ord, content, embedding)
           SELECT $1, * FROM unnest($2::int[], $3::text[], $4::vector[])`,
          [docId, ords, contents, vectors]
        );

        // Generar resumen
        const summary = await summarizeDocument(title, text).catch(() => "");

        // Actualizar estado a 'ready'
        const finalSummary = summary.trim() ? summary.trim() : null;
        await execute(
          `UPDATE documents SET status = 'ready', error = NULL, summary = $2 WHERE id = $1`,
          [docId, finalSummary]
        );
        await maybeSendEmail(user.id, title, "ready", finalSummary, null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const errorMessage = msg.length > 500 ? msg.substring(0, 500) : msg;
        await execute(
          `UPDATE documents SET status = 'failed', error = $2 WHERE id = $1`,
          [docId, errorMessage]
        );
        await maybeSendEmail(user.id, title, "failed", null, errorMessage);
      }
    });

    return NextResponse.json(immediateResponse, { status: 202 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: msg } }, { status: 500 });
  }
}
