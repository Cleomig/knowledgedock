/**
 * Techo de inactividad para los streams de texto de los proveedores IA.
 *
 * Un stream puede quedarse mudo sin cerrar ni fallar: en producción Gemini
 * emitió `[start]` y luego nada durante más de un minuto. Sin un tope, el
 * consumidor espera para siempre, el SSE no se cierra, el cliente se queda en
 * `await reader.read()` y el compositor permanece deshabilitado sin que el
 * usuario vea un solo error.
 *
 * Este tope vive en el consumidor (la ruta `/api/ask`) y no en cada proveedor
 * para que cubra por igual a Gemini, Groq y OpenRouter, y a los que se añadan.
 */
export const STREAM_IDLE_TIMEOUT_MS = 45_000;

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
