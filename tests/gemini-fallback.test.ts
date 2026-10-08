import { describe, it, expect, beforeEach, vi } from "vitest";
import { GeminiProvider } from "../src/lib/ai/gemini";
import { FIRST_CHUNK_TIMEOUT_MS } from "../src/lib/ai/idle-timeout";

/**
 * Comportamiento de los modelos de respaldo en `GeminiProvider.streamChat`.
 *
 * Regresiones que cubre, todas observadas contra la API real:
 *
 *  - La cuota gratuita es por modelo (20 req/día) y Gemini devuelve 503
 *    "high demand" en picos. Antes, un fallo del primario se traducía en un
 *    stream vacío y /api/ask emitía [done] con la respuesta en blanco.
 *  - El SDK de AI registra el error con `onError` pero NO rechaza el
 *    iterable: hay que capturarlo a mano para poder mostrar la causa real.
 *  - Una vez emitido texto no se puede cambiar de modelo: la respuesta
 *    quedaría mezclada entre dos modelos.
 */
const { streamTextMock } = vi.hoisted(() => ({ streamTextMock: vi.fn() }));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, streamText: streamTextMock };
});

/** Stream que termina limpio sin emitir nada (lo que hace el SDK al fallar). */
function emptyStream() {
  return { async *[Symbol.asyncIterator]() {} };
}

/** Stream que emite los trozos dados. */
function textStream(chunks: string[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
  };
}

/** Stream que emite los trozos dados y luego revienta. */
function throwingStream(chunks: string[], message: string) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
      throw new Error(message);
    },
  };
}

/** Stream que nunca emite ni termina: el modelo se queda mudo sin fallar. */
function silentStream() {
  return {
    async *[Symbol.asyncIterator]() {
      await new Promise(() => {});
    },
  };
}

type Plan =
  | { text: string }
  | { error: string }
  | { silent: true }
  | { crash: { chunks: string[]; message: string } };

/** Modelos que el proveedor ha intentado, en orden. */
let attempts: string[] = [];

/**
 * Secuencia de comportamientos: una entrada por `streamText` (es decir, por
 * modelo que se intente, en orden).
 *
 * `{ error }` simula el fallo real: el SDK llama a `onError` y cierra el
 * stream limpio sin rechazarlo. `{ text }` es un modelo sano.
 */
function plan(...steps: Plan[]) {
  streamTextMock.mockImplementation(
    (opts: {
      model?: { modelId?: string };
      onError?: (e: { error: unknown }) => void;
    }) => {
      attempts.push(String(opts.model?.modelId ?? "??"));
      const step = steps.shift();
      if (!step) throw new Error("plan agotado: se intentó un modelo de más");
      if ("error" in step) {
        opts.onError?.({ error: new Error(step.error) });
        return { textStream: emptyStream() };
      }
      if ("silent" in step) {
        return { textStream: silentStream() };
      }
      if ("crash" in step) {
        return { textStream: throwingStream(step.crash.chunks, step.crash.message) };
      }
      return { textStream: textStream([step.text]) };
    }
  );
}

async function drain(stream: AsyncIterable<string>) {
  const chunks: string[] = [];
  let error: unknown = null;
  try {
    for await (const c of stream) chunks.push(c);
  } catch (err) {
    error = err;
  }
  return { chunks, error };
}

function ask(provider: GeminiProvider) {
  return provider.streamChat([{ role: "user", content: "hola" }]);
}

describe("GeminiProvider.streamChat — modelos de respaldo", () => {
  const provider = () =>
    new GeminiProvider({
      GEMINI_API_KEY: "test-key",
    } as unknown as NodeJS.ProcessEnv);

  beforeEach(() => {
    streamTextMock.mockReset();
    attempts = [];
  });

  it("cae al siguiente modelo cuando el primero falla antes de emitir", async () => {
    plan(
      { error: "This model is currently experiencing high demand." },
      { text: "respuesta del respaldo" }
    );

    const { chunks, error } = await drain((await ask(provider())).textStream);

    expect(error).toBeNull();
    expect(chunks.join("")).toBe("respuesta del respaldo");
    expect(attempts).toHaveLength(2);
  });

  it("propaga el error REAL del proveedor, no un mensaje genérico", async () => {
    // Más pasos que modelos candidatos para que `lastError` sea siempre el
    // error del proveedor y no el centinela "plan agotado" de este test.
    plan(
      { error: "This model is currently experiencing high demand." },
      { error: "This model is currently experiencing high demand." },
      { error: "This model is currently experiencing high demand." },
      { error: "This model is currently experiencing high demand." },
      { error: "This model is currently experiencing high demand." },
      { error: "This model is currently experiencing high demand." }
    );

    const { chunks, error } = await drain((await ask(provider())).textStream);

    expect(chunks).toEqual([]);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("high demand");
  });

  it("prima el modelo configurado y no repite ninguno", async () => {
    // Más pasos que modelos: si el bucle llegara a repetir o a pedir de más,
    // `plan` lanzaría "plan agotado".
    plan(
      { error: "a" }, { error: "b" }, { error: "c" }, { error: "d" },
      { error: "e" }, { error: "f" }, { error: "g" }
    );

    const { error } = await drain((await ask(provider())).textStream);

    expect(error).toBeInstanceOf(Error);
    expect(attempts[0]).toBe("gemini-3.7-flash");
    expect(new Set(attempts).size).toBe(attempts.length);
    expect(attempts.length).toBeGreaterThan(1);
    expect(attempts.length).toBeLessThan(7);
  });

  it("trata un stream vacío como fallo aunque no llame a onError", async () => {
    plan({ text: "" }, { text: "ok" });

    const { chunks, error } = await drain((await ask(provider())).textStream);

    expect(error).toBeNull();
    expect(chunks.join("")).toBe("ok");
    expect(attempts).toHaveLength(2);
  });

  it("NO cambia de modelo una vez que ya emitió texto", async () => {
    plan(
      { crash: { chunks: ["texto parcial"], message: "explotó a mitad" } },
      { text: "no debería usarse" }
    );

    const { chunks, error } = await drain((await ask(provider())).textStream);

    // Mezclar dos modelos a mitad de frase daría una respuesta incoherente:
    // se entrega lo emitido y se propaga el error.
    expect(chunks).toEqual(["texto parcial"]);
    expect((error as Error).message).toContain("explotó a mitad");
    expect(attempts).toHaveLength(1);
  });

  it("salta de modelo si el primero se queda mudo sin emitir nada", async () => {
    // Regresión medida en producción el 2026-10-08: el primario devolvía 429
    // de cuota y el segundo 503, y /api/ask se quedaba mudo 45 s. El silencio
    // no dispara onError, así que el bucle de respaldo se quedaba esperando
    // el primer trozo sin llegar JAMÁS al modelo sano.
    vi.useFakeTimers();
    try {
      plan({ silent: true }, { text: "respuesta del respaldo" });

      const pending = drain((await ask(provider())).textStream);
      await vi.advanceTimersByTimeAsync(FIRST_CHUNK_TIMEOUT_MS);
      const { chunks, error } = await pending;

      expect(error).toBeNull();
      expect(chunks.join("")).toBe("respuesta del respaldo");
      expect(attempts).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("invoca streamText sin reintentos para no encadenar backoff", async () => {
    plan({ text: "hola" });

    await drain((await ask(provider())).textStream);

    // 3 reintentos con backoff son ~17-23 s POR MODELO: con cuatro
    // candidatos el tope de la ruta se imponía antes de llegar al sano.
    expect(streamTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ maxRetries: 0 })
    );
  });
});
