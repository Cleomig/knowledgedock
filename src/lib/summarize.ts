import { getAiProvider } from "./ai";

const MAX_CHARS = 8000;

/**
 * Summariza un documento dado su título y contenido.
 *
 * - Recorta el texto a los primeros 8000 caracteres para acotar coste.
 * - Usa el proveedor IA configurado vía getAiProvider() (OpenRouter, Gemini, etc.).
 * - El prompt pide 3 a 5 bullets y una línea de conclusión final en español.
 * - Devuelve solo texto plano, sin bloques de código markdown.
 * - Si ocurre cualquier error, devuelve cadena vacía en vez de propagar la excepción.
 */
export async function summarizeDocument(
  title: string,
  text: string
): Promise<string> {
  const truncated = text.slice(0, MAX_CHARS);

  const prompt = `Eres un asistente especializado en resumir documentos.
Título del documento: ${title}

Texto a resumir:
${truncated}

Instrucciones:
- Genera un resumen conciso en español.
- Usa entre 3 y 5 viñetas (bullets) con guiones (-).
- Finaliza con exactamente UNA línea de conclusión que empiece por "Conclusión: ".
- Devuelve solo texto plano. No uses bloques de código markdown.
- No incluyas el título ni repitas información innecesaria.`;

  try {
    const provider = getAiProvider();
    const result = await provider.chat([
      { role: "user", content: prompt },
    ]);
    return result.text ?? "";
  } catch {
    return "";
  }
}
