/**
 * Segmentación del texto de una respuesta para separar las referencias de
 * cita del texto normal.
 *
 * Motivo: el system prompt pide citar con `[n]`, pero los modelos escriben
 * también grupos (`[3, 5]`), espacios (`[ 3 ]`) y referencias a números que
 * nunca existieron. Todo eso se pintaba como texto muerto: el lector veía
 * `[3, 5]` a mitad de la frase sin poder comprobar de qué documento hablaba
 * la respuesta. Aquí se localizan para que la UI pueda volverlos clicables.
 */

export type CitationSegment =
  | { kind: "text"; text: string }
  /**
   * `raw` conserva el texto exacto tal y como lo escribió el modelo. Hace
   * falta para devolverlo intacto cuando el número no tiene chip, y permite
   * reconstruir el mensaje original sin pérdidas.
   */
  | { kind: "markers"; numbers: number[]; raw: string };

/**
 * Un marcador es un corchete con al menos un número, separados por comas.
 * Se aceptan espacios alrededor de todo: los modelos los añaden de forma
 * inconsistente (`[3]`, `[ 3 ]`, `[3, 5]`, `[3 , 5]`).
 */
const MARKER_PATTERN = /\[\s*(\d+(?:\s*,\s*\d+)*)\s*\]/g;

/**
 * Parte el texto en segmentos de texto plano y grupos de referencias.
 *
 * Propiedad importante: `joinSegments(parseCitationMarkers(t)) === t`. El
 * parseo no puede perder ni reescribir un solo carácter, o la respuesta del
 * modelo llegaría truncada o alterada al usuario.
 *
 * Un corchete sin número (`[hola]`, `[]`) no es una referencia de cita y se
 * queda como texto: tratarlo como enlace produciría botones rotos.
 */
export function parseCitationMarkers(text: string): CitationSegment[] {
  if (text === "") return [];

  const segments: CitationSegment[] = [];
  const pattern = new RegExp(MARKER_PATTERN.source, "g");
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, match.index) });
    }

    const numbers = match[1]
      .split(",")
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isInteger(value));

    segments.push({ kind: "markers", numbers, raw: match[0] });
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    segments.push({ kind: "text", text: text.slice(cursor) });
  }

  return segments;
}

/** Vuelve a pegar los segmentos en el texto original, sin pérdidas. */
export function joinSegments(segments: CitationSegment[]): string {
  return segments
    .map((segment) => (segment.kind === "text" ? segment.text : segment.raw))
    .join("");
}
