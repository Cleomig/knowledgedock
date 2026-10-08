import { NextResponse } from "next/server";
import { after } from "next/server";
import { getAiProvider } from "@/lib/ai";
import { query, execute } from "@/lib/db";
import { getAuthenticatedUser, unauthorizedResponse } from "@/lib/auth-session";
import { sendDocumentEmail } from "@/lib/email";
// Import estático (no `require`): `require` con alias `@/` no se resuelve en
// el entorno de tests de Vitest, y estos módulos son baratos (pdf-parse ya se
// carga de forma perezosa dentro de `extractPdfText`).
import { chunkText, extractPdfText, ocrPdfText, detectPdfScanStatus, buildDocumentError, type DocumentErrorCode } from "@/lib/chunking";
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
  error_code: string | null;
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
       SET status = 'failed', error = 'Procesamiento agotado', error_code = 'PROCESSING_TIMEOUT'
       WHERE owner_id = $1 
       AND status = 'processing' 
       AND created_at < NOW() - INTERVAL '5 minutes'`,
      [user.id]
    );

    const rows = await query<DocumentRow>(
      `SELECT id, title, mime_type, created_at, status, error, error_code, summary
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
        let errorResult: ReturnType<typeof buildDocumentError> | null = null;
        
        // Extracción de texto según tipo
        if (mimeType === "application/pdf") {
          text = await extractPdfText(buffer) ?? "";
          
          // Si el PDF no tiene texto, verificar si es escaneado e intentar OCR
          if (!text || text.trim().length === 0) {
            const scanInfo = await detectPdfScanStatus(buffer);
            
            if (scanInfo.isScanned && scanInfo.pageCount > 0) {
              // Intentar OCR como fallback
              try {
                const ocrText = await ocrPdfText(buffer);
                text = ocrText ?? "";
                if (!text || text.trim().length === 0) {
                  // OCR falló
                  const errorCode: DocumentErrorCode = "OCR_FAILED";
                  errorResult = buildDocumentError(errorCode, 
                    `PDF escaneado (${scanInfo.pageCount} página(s)): OCR no pudo extraer texto`
                  );
                }
              } catch {
                const errorCode: DocumentErrorCode = "OCR_FAILED";
                errorResult = buildDocumentError(errorCode, 
                  `PDF escaneado (${scanInfo.pageCount} página(s)): OCR falló`
                );
              }
              
              // Si aún no hay error y no hay texto, es PDF_EMPTY
              if (!errorResult && (!text || text.trim().length === 0)) {
                const errorCode: DocumentErrorCode = "PDF_EMPTY";
                errorResult = buildDocumentError(errorCode, "El PDF no contiene texto extraíble");
              }
            } else {
              // No son páginas, es PDF vacío
              const errorCode: DocumentErrorCode = "PDF_EMPTY";
              errorResult = buildDocumentError(errorCode, "El PDF no contiene texto extraíble");
            }
          }
        } else if (
          mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
          file.name.toLowerCase().endsWith(".docx")
        ) {
          text = await extractDocxText(buffer) ?? "";
          if (!text || text.trim().length === 0) {
            errorResult = buildDocumentError("DOCX_EMPTY", "No se pudo extraer texto del documento Word");
          }
        } else if (mimeType.startsWith("text/")) {
          text = buffer.toString("utf-8");
          if (!text || text.trim().length === 0) {
            errorResult = buildDocumentError("TEXT_EMPTY", "El archivo de texto está vacío");
          }
        } else {
          // No debería llegar aquí por la validación anterior, pero por seguridad
          throw new Error(`Tipo MIME no soportado: ${mimeType}`);
        }

        // Si hubo error de extracción, actualizar y salir
        if (errorResult) {
          await execute(
            `UPDATE documents SET status = 'failed', error = $2, error_code = $3 WHERE id = $1`,
            [docId, errorResult.userMessage, errorResult.code]
          );
          await maybeSendEmail(user.id, title, "failed", null, errorResult.userMessage);
          return;
        }

        // Chunking
        const chunks = chunkText(text);

        if (chunks.length === 0) {
          await execute(
            `UPDATE documents SET status = 'failed', error = $2, error_code = $3 WHERE id = $1`,
            [docId, 'El documento no produjo chunks', 'TEXT_EMPTY']
          );
          await maybeSendEmail(user.id, title, "failed", null, 'El documento no produjo chunks');
          return;
        }

        // Embedding en lote
        const provider = getAiProvider();
        const embeddings = await provider.embedBatch(chunks, {
          taskType: "retrieval_document",
        }).catch(() => {
          throw new Error("Error al generar embeddings");
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
          `UPDATE documents SET status = 'ready', error = NULL, error_code = NULL, summary = $2 WHERE id = $1`,
          [docId, finalSummary]
        );
        await maybeSendEmail(user.id, title, "ready", finalSummary, null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        
        // Determinar código de error según el mensaje
        let errorCode: DocumentErrorCode = "PROCESSING_TIMEOUT";
        let userMessage = msg;
        
        if (msg.includes("embedding") || msg.includes("Embedding")) {
          errorCode = "EMBEDDING_FAILED";
          const errResult = buildDocumentError(errorCode, msg);
          userMessage = errResult.userMessage;
        } else if (msg.includes("timeout") || msg.includes("agotado")) {
          errorCode = "PROCESSING_TIMEOUT";
          const errResult = buildDocumentError(errorCode, msg);
          userMessage = errResult.userMessage;
        } else if (msg.includes("no soportado") || msg.includes("MIME")) {
          userMessage = "Tipo de archivo no soportado";
        }
        
        const errorMessage = userMessage.length > 500 ? userMessage.substring(0, 500) : userMessage;
        
        await execute(
          `UPDATE documents SET status = 'failed', error = $2, error_code = $3 WHERE id = $1`,
          [docId, errorMessage, errorCode]
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
