import { describe, expect, it, vi } from "vitest";
import {
  FIRST_CHUNK_TIMEOUT_MS,
  STREAM_IDLE_TIMEOUT_MS,
  withIdleTimeout,
} from "@/lib/ai/idle-timeout";

describe("withIdleTimeout", () => {
  it("devuelve el valor cuando la promesa llega antes del tope", async () => {
    vi.useFakeTimers();
    try {
      const p = withIdleTimeout(Promise.resolve("hola"), STREAM_IDLE_TIMEOUT_MS);

      await expect(p).resolves.toBe("hola");
      // El temporizador se limpia: no queda nada colgando del bucle de eventos.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rechaza con un mensaje accionable cuando el proveedor se queda mudo", async () => {
    vi.useFakeTimers();
    try {
      // Una promesa que nunca se resuelve: así queda en producción un stream
      // que emite `[start]` y luego nada.
      const hung = new Promise<string>(() => {});
      const p = withIdleTimeout(hung, STREAM_IDLE_TIMEOUT_MS);

      // Se prepara la aserción ANTES de avanzar el reloj para no esperar para
      // siempre a una promesa que todavía no ha rechazado.
      const assertion = expect(p).rejects.toThrow(
        /dejó de enviar texto durante 45 segundos/
      );
      await vi.advanceTimersByTimeAsync(STREAM_IDLE_TIMEOUT_MS);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("propaga el rechazo original cuando llega antes del tope", async () => {
    vi.useFakeTimers();
    try {
      const p = withIdleTimeout(
        Promise.reject(new Error("cuota agotada")),
        STREAM_IDLE_TIMEOUT_MS
      );

      await expect(p).rejects.toThrow("cuota agotada");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("el tope de primer trozo es menor que el tope global", () => {
    // Si no, un primer modelo mudo agotaría el presupuesto de la ruta antes
    // de que el bucle de respaldo llegara al modelo sano.
    expect(FIRST_CHUNK_TIMEOUT_MS).toBeLessThan(STREAM_IDLE_TIMEOUT_MS);
  });
});
