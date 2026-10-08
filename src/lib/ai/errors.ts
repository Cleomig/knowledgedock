/**
 * Adaptación de errores del proveedor IA para consumo del usuario.
 *
 * Los errores del SDK de AI son multi-líneas y muy verbosos ("Failed after
 * 3 attempts. Last error: AI_APICallError: ... at file:///C:/..."), así que
 * meterlos tal cual en un `[error: ...]` produce un muro de texto ilegible.
 *
 * Además el payload se inyecta en un stream SSE con formato `data: <texto>`,
 * así que cualquier salto de línea partiría el evento en dos. Por eso la
 * salida es siempre UNA sola línea.
 */
export function humanError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // En un 429 de Gemini la primera línea es genérica ("You exceeded your
  // current quota..."); la útil es la de cuota, con el modelo y el tiempo
  // de espera. Viene marcada con un `* ` de viñeta, así que normalizamos
  // antes de comparar. La buscamos antes de quedarnos con la primera.
  const quota = lines
    .map((l) => l.replace(/^[\s*\-•]+/, ""))
    .find((l) => l.startsWith("Quota exceeded for metric:"));
  if (quota) {
    const retry = lines
      .map((l) => l.replace(/^[\s*\-•]+/, ""))
      .find((l) => l.startsWith("Please retry in"));
    return clip(`${quota}${retry ? ` ${retry}.` : ""}`);
  }

  return clip(lines[0] ?? "Error desconocido del proveedor IA");
}

/**
 * Extrae el mensaje de un evento SSE de error con formato `[error: <msg>]`.
 * Devuelve `null` si el evento no es de error.
 *
 * Solo se retira el `]` que cierra el envoltorio. Un `replace(']', '')` se
 * comería el primer corchete del propio mensaje (p. ej.
 * "AI_APICallError: [503 Service Unavailable]") y dejaría el texto a medias.
 */
export function parseErrorEvent(payload: string): string | null {
  if (!payload.startsWith('[error:')) return null;
  const raw = payload.slice('[error:'.length);
  const msg = raw.endsWith(']') ? raw.slice(0, -1) : raw;
  // El envoltorio es `[error: <msg>]`, con un espacio de separación.
  return msg.trim();
}

/** Corta a 300 caracteres (incluido el `…`) para no saturar la UI. */
function clip(text: string): string {
  return text.length > 300 ? `${text.slice(0, 299)}…` : text;
}
