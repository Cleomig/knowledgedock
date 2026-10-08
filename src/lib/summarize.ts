import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

const MAX_CHARS = 8000;

/**
 * Summariza un documento dado su título y contenido.
 *
 * - Recorta el texto a los primeros 8000 caracteres para acotar coste.
 * - Usa el SDK de AI directamente con el proveedor de Google (Gemini),
 *   leyendo GEMINI_API_KEY del entorno (misma convención que src/lib/ai/gemini.ts).
 * - El prompt pide 3 a 5 bullets y una línea de conclusión final en español.
 * - Devuelve solo texto plano, sin bloques de código markdown.
 * - Si ocurre cualquier error, devuelve cadena vacía en vez de propagar la excepción.
 */
export async function summarizeDocument(
  title: string,
  text: string
): Promise<string> {
  const truncated = text.slice(0, MAX_CHARS);

  const apiKey = process.env.GEMINI_API_KEY ?? "";
  const modelId = process.env.GEMINI_CHAT_MODEL ?? "gemini-3.7-flash";
  const sdk = createGoogleGenerativeAI({ apiKey });

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
    const result = await generateText({
      model: sdk.languageModel(modelId),
      messages: [{ role: "user", content: prompt }],
      abortSignal: AbortSignal.timeout(20000),
    });
    return result.text ?? "";
  } catch {
    return "";
  }
}
