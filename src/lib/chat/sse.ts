import { parseErrorEvent } from '@/lib/ai/errors';

export interface Citation {
  id: string;
  sourceText: string;
  docTitle: string;
}

export type StreamEvent =
  | { kind: 'skip' }
  | { kind: 'error'; message: string }
  | { kind: 'citation'; citation: Citation }
  | { kind: 'text'; text: string };

const CONTROL_MARKERS = new Set(['[start]', '[done]', '[context]']);

/**
 * Acumula los trozos de red y devuelve los payloads `data:` completos.
 *
 * Motivo: el texto del modelo trae saltos de línea reales. SSE no permite
 * un `\n` dentro de un `data:`: hay que repartirlo en varias líneas `data:`
 * y cerrar el evento con una línea vacía. El receptor debe volver a unirlas
 * con `\n` ANTES de clasificar.
 *
 * Sin esto, cualquier salto de línea del modelo hacía que la continuación
 * llegara como línea "huérfana" (sin prefijo `data:`) y el bucle la
 * descartara: la respuesta se quedaba cortada justo en el primer `\n`.
 *
 * Los campos que no son `data:` (event:, id:, retry:) y los comentarios se
 * ignoran, como marca la especificación. Se conserva cada espacio exacto:
 * un `trim()` aquí se comía el espacio inicial de `" son:"` y degradaba la
 * lectura del texto unido.
 */
export class SSEDecoder {
  private buffer = '';
  private data: string[] = [];

  /** Introduce un trozo crudo del stream y devuelve los eventos completos. */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    // La última parte puede estar incompleta: se queda para el próximo trozo.
    this.buffer = lines.pop() ?? '';

    const events: string[] = [];
    for (const rawLine of lines) {
      // SSE cierra cada línea con `\n` o `\r\n`.
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

      if (line === '') {
        if (this.data.length > 0) {
          events.push(this.data.join('\n'));
          this.data = [];
        }
        continue;
      }

      if (line.startsWith('data:')) {
        const value = line.slice(5);
        this.data.push(value.startsWith(' ') ? value.slice(1) : value);
      }
    }
    return events;
  }
}

/**
 * Clasifica un payload de `data: ...` del stream SSE de `/api/ask`.
 *
 * Orden importante:
 * 1. Marcadores de control → se ignoran.
 * 2. Eventos de error → lanzar, nunca pintar como texto.
 * 3. Citas en JSON → al listado de citas.
 * 4. Todo lo demás → TEXTO, incluido JSON que no sea una cita.
 *
 * El paso 4 es el importante: antes se hacía `JSON.parse` y, si parseaba
 * pero no era una cita, se descartaba el trozo EN SILENCIO. Un modelo que
 * emitiera `123`, `true` o `{"a":1}` perdía texto sin aviso. Ahora el
 * único caso que no es texto son los marcadores, el error y las citas.
 */
export function parseStreamEvent(payload: string): StreamEvent {
  if (CONTROL_MARKERS.has(payload)) return { kind: 'skip' };

  const errMsg = parseErrorEvent(payload);
  if (errMsg !== null) return { kind: 'error', message: errMsg };

  try {
    const parsed: unknown = JSON.parse(payload);
    if (parsed !== null && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;

      // /api/ask emite además un error en JSON antes del [error: ...].
      if (obj.type === 'error' && typeof obj.message === 'string') {
        return { kind: 'error', message: obj.message };
      }

      if (obj.type === 'citation') {
        return {
          kind: 'citation',
          citation: {
            id: String(obj.index ?? ''),
            sourceText: typeof obj.content === 'string' ? obj.content : '',
            docTitle: typeof obj.source === 'string' ? obj.source : '',
          },
        };
      }
    }
  } catch {
    // No era JSON: es texto normal del modelo.
  }

  return { kind: 'text', text: payload };
}
