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

/**
 * Ejecuta OCR sobre un PDF escaneado usando tesseract.js.
 * Extrae cada página como imagen y reconoce el texto.
 * Retorna null si falla el OCR.
 */
export async function ocrPdfText(buffer: Buffer): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require("pdf-parse");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Tesseract = require("tesseract.js");

    const data = await pdfParse(buffer);
    const pages = data.pages || [];

    if (pages.length === 0) return null;

    const texts: string[] = [];

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      if (!page?.image?.data) continue;

      try {
        const imageUrl = `data:image/png;base64,${Buffer.from(page.image.data).toString("base64")}`;
        const { data: ocrData } = await Tesseract.recognize(imageUrl, "spa", {
          logger: () => {}, // Silenciar logs de progreso
        });
        if (ocrData?.text?.trim()) {
          texts.push(ocrData.text.trim());
        }
      } catch {
        // Ignorar páginas que fallen
      }
    }

    return texts.length > 0 ? texts.join("\n\n") : null;
  } catch {
    return null;
  }
}

/**
 * Detalla si un PDF es escaneado (tiene páginas pero sin texto extraíble).
 * Devuelve el número de páginas o null si no se pudo determinar.
 */
export async function detectPdfScanStatus(buffer: Buffer): Promise<{ isScanned: boolean; pageCount: number }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require("pdf-parse");
    const data = await pdfParse(buffer);
    const pageCount = data?.numpages ?? 0;
    const hasNoText = !data?.text || data.text.trim().length === 0;
    return { isScanned: hasNoText && pageCount > 0, pageCount };
  } catch {
    return { isScanned: false, pageCount: 0 };
  }
}

/** Tipo de error estructurado para documentos fallidos */
export type DocumentErrorCode =
  | "PDF_SCANNED"
  | "PDF_EMPTY"
  | "DOCX_EMPTY"
  | "TEXT_EMPTY"
  | "EMBEDDING_FAILED"
  | "PROCESSING_TIMEOUT"
  | "OCR_FAILED";

/** Genera un objeto de error estructurado a partir del error de procesamiento */
export function buildDocumentError(
  code: DocumentErrorCode,
  _rawMessage: string
): { code: DocumentErrorCode; userMessage: string; suggestions: string[] } {
  const map: Record<DocumentErrorCode, { userMessage: string; suggestions: string[] }> = {
    PDF_SCANNED: {
      userMessage: "PDF escaneado: no se pudo extraer texto automático",
      suggestions: [
        "Usa OCR (como Adobe Acrobat o onlineOCR.net) para convertir el PDF a texto",
        "Extrae el texto manualmente y guárdalo como .txt o .md",
        "Reenvía una versión digital del documento si está disponible",
      ],
    },
    PDF_EMPTY: {
      userMessage: "El PDF está vacío o solo contiene imágenes",
      suggestions: [
        "Verifica que el PDF contenga texto seleccionable",
        "Convierte las imágenes del PDF a texto usando una herramienta OCR",
        "Usa un archivo .txt o .md con el contenido deseado",
      ],
    },
    DOCX_EMPTY: {
      userMessage: "No se pudo extraer texto del documento Word",
      suggestions: [
        "Verifica que el documento Word tenga contenido de texto visible",
        "Guarda el documento como .txt o .md y reinténtalo",
      ],
    },
    TEXT_EMPTY: {
      userMessage: "El archivo de texto está vacío",
      suggestions: [
        "Asegúrate de que el archivo .txt o .md contenga contenido",
        "Abre el archivo y verifica que tenga texto escrito",
      ],
    },
    EMBEDDING_FAILED: {
      userMessage: "Error al generar representaciones del documento",
      suggestions: [
        "El documento tiene demasiado texto para procesar en un solo lote",
        "Intenta dividir el documento en archivos más pequeños",
        "Reintenta más tarde si el servicio de embeddings estaba ocupado",
      ],
    },
    PROCESSING_TIMEOUT: {
      userMessage: "El procesamiento tardó demasiado y se canceló",
      suggestions: [
        "Intenta dividir el documento en secciones más pequeñas",
        "Reintenta la subida dentro de unos minutos",
      ],
    },
    OCR_FAILED: {
      userMessage: "OCR falló: no se pudo reconocer el texto del PDF escaneado",
      suggestions: [
        "El OCR requiere más tiempo; intenta con un PDF más pequeño",
        "Usa una herramienta OCR externa (Adobe Acrobat, onlineOCR.net)",
        "Convierte manualmente a texto y guarda como .txt o .md",
      ],
    },
  };
  return {
    code,
    userMessage: map[code].userMessage,
    suggestions: map[code].suggestions,
  };
}
