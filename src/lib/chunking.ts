/**
 * Chunking de texto para documentos.
 * - TokenSize: ~500 caracteres (aproximación a ~125 tokens)
 * - Superposición: 50 caracteres para mantener contexto entre chunks
 */

const TOKEN_SIZE = 500;
const OVERLAP = 50;

/**
 * Divide un texto en chunks con superposición controlada.
 * No corta palabras a la mitad: busca el último espacio dentro del rango.
 */
export function chunkText(text: string, maxSize = TOKEN_SIZE, overlap = OVERLAP): string[] {
  if (!text || text.trim().length === 0) return [];
  if (text.length <= maxSize) return [text.trim()];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + maxSize, text.length);

    // No cortar a la mitad de una palabra: retroceder al último espacio
    if (end < text.length) {
      const lastSpace = text.lastIndexOf(" ", end);
      if (lastSpace > start) {
        end = lastSpace;
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    // Avanzar: nuevo inicio = fin actual - overlap
    start = end - overlap;
    if (start <= chunks.length * maxSize - overlap) {
      start = Math.max(start, chunks.length * maxSize - overlap + 1);
    }
    // Evitar bucle infinito si overlap >= maxSize
    if (start <= 0) start = end + 1;
  }

  return chunks;
}

/**
 * Extrae texto plano de un documento PDF usando pdf-parse.
 * Retorna null si la extracción falla.
 */
export async function extractPdfText(buffer: Buffer): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require("pdf-parse");
    const data = await pdfParse(buffer);
    return data.text ?? null;
  } catch {
    return null;
  }
}
