/**
 * Techos de inactividad para los streams de texto de los proveedores IA.
 *
 * Un stream puede quedarse mudo sin cerrar ni fallar. En producción Gemini
 * emitió `[start]` y luego nada durante más de un minuto: sin un tope, el
 * consumidor espera para siempre, el SSE no se cierra, el cliente se queda en
 * `await reader.read()` y el compositor permanece deshabilitado sin que el
 * usuario vea un solo error.
 *
 * Hay DOS topes porque hay DOS silencios distintos:
 *
 *  - `FIRST_CHUNK_TIMEOUT_MS` vive DENTRO del proveedor y se aplica por modelo
 *    candidato mientras espera el primer trozo. Un modelo mudo debe FALLAR y
 *    ceder paso al siguiente, no bloquear el bucle de respaldo.
 *  - `STREAM_IDLE_TIMEOUT_MS` vive en el consumidor (la ruta `/api/ask`) y
 *    cubre por igual a Gemini, Groq y OpenRouter, y a los que se añadan. Es el
 *    último recurso: se dispara cuando ya no queda modelo al que saltar (o
 *    cuando el silencio llega DESPUÉS de emitir texto, donde cambiar de modelo
 *    mezclaría dos respuestas).
 */

/** Último recurso, en el consumidor. Debe ser menor que `maxDuration` de la ruta. */
export const STREAM_IDLE_TIMEOUT_MS = 45_000;

/**
 * Paciencia con UN modelo candidato antes de rendirse y probar el siguiente.
 *
 * Medido en producción el 2026-10-08 sondeando los cuatro candidatos en
 * caliente: el primario devolvía 429 de cuota y el segundo 503 "high demand",
 * y el SDK reintentaba 3 veces cada uno con backoff (~17-23 s por modelo). Con
 * 4 candidatos eso son hasta 90 s, muy por encima del tope del consumidor: el
 * respaldo nunca llegaba al modelo sano (`gemini-3.5-flash` respondía en 1,2 s).
 *
 * Por eso es un tope corto Y por eso `streamText` se invoca con
 * `maxRetries: 0`: probar el modelo siguiente es más barato que reintentar el
 * mismo.
 */
export const FIRST_CHUNK_TIMEOUT_MS = 12_000;

/**
 * Espera `promise` y, si tarda más de `ms`, rechaza con un mensaje accionable.
 *
 * `Promise.race` engancha un manejador a las DOS promesas: si gana el reloj,
 * la promesa original sigue cubierta y su eventual rechazo (o resolución)
 * tardía no acaba en un `unhandledRejection`. El temporizador se limpia siempre
 * para no dejar el bucle de eventos del servidor con un timer vivo.
 */
export function withIdleTimeout<T>(
  promise: Promise<T>,
  ms: number
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new Error(
            `El proveedor IA dejó de enviar texto durante ${Math.round(
              ms / 1000
            )} segundos. Vuelve a intentarlo y, si insiste, prueba más tarde.`
          )
        );
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
