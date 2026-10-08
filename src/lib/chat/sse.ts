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
