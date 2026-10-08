import { Resend } from "resend";

const EMAIL_FROM = process.env.EMAIL_FROM ?? "KnowledgeDock <onboarding@resend.dev>";

let _resend: Resend | null = null;

function getResend(): Resend {
  if (!_resend) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error("RESEND_API_KEY no está configurada.");
    }
    _resend = new Resend(apiKey);
  }
  return _resend;
}

export interface DocumentEmailParams {
  to: string;
  title: string;
  status: "ready" | "failed";
  summary?: string | null;
  error?: string | null;
}

function buildSubject(title: string, status: "ready" | "failed"): string {
  if (status === "ready") {
    return `Tu documento "${title}" está listo`;
  }
  return `Error al procesar "${title}"`;
}

function buildHtml(params: DocumentEmailParams): string {
  const { title, status, summary, error } = params;

  if (status === "ready") {
    const summaryHtml = summary
      ? `<div style="margin:16px 0;padding:16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;">
           <p style="margin:0 0 8px;font-weight:600;color:#166534;">Resumen:</p>
           <pre style="margin:0;white-space:pre-wrap;font-family:inherit;color:#1a1a1a;">${escapeHtml(summary)}</pre>
         </div>`
      : "";

    return `<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a1a;">
  <h2 style="color:#166534;">Tu documento está listo</h2>
  <p>El documento <strong>${escapeHtml(title)}</strong> se procesó correctamente.</p>
  ${summaryHtml}
  <p style="color:#666;font-size:13px;">KnowledgeDock — Asistente de documentos con IA</p>
</body>
</html>`;
  }

  return `<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a1a;">
  <h2 style="color:#dc2626;">Error al procesar el documento</h2>
  <p>El documento <strong>${escapeHtml(title)}</strong> no se pudo procesar.</p>
  <div style="margin:16px 0;padding:16px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;">
    <p style="margin:0;color:#991b1b;">${escapeHtml(error ?? "Error desconocido")}</p>
  </div>
  <p style="color:#666;font-size:13px;">KnowledgeDock — Asistente de documentos con IA</p>
</body>
</html>`;
}

function buildText(params: DocumentEmailParams): string {
  const { title, status, summary, error } = params;

  if (status === "ready") {
    let text = `Tu documento "${title}" está listo.\n`;
    if (summary) {
      text += `\nResumen:\n${summary}\n`;
    }
    return text;
  }

  return `Error al procesar "${title}".\n\n${error ?? "Error desconocido"}\n`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Envía un email de aviso sobre el resultado del procesamiento de un documento.
 * Lanza en caso de error (el caller debe decidir si lo captura).
 */
export async function sendDocumentEmail(params: DocumentEmailParams): Promise<void> {
  const resend = getResend();

  const { error } = await resend.emails.send({
    from: EMAIL_FROM,
    to: params.to,
    subject: buildSubject(params.title, params.status),
    text: buildText(params),
    html: buildHtml(params),
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
}
