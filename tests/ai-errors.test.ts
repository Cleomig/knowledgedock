import { describe, expect, it } from "vitest";
import { humanError, parseErrorEvent } from "@/lib/ai/errors";

/**
 * Mensaje literal que devolvió Gemini en producción el día del 429.
 * Ver: f130789 (fix de /api/ask). La línea de cuota viene con viñeta `* `.
 */
const CUOTA_REAL = [
  "You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit.",
  "* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-3.8-flash",
  "Please retry in 20h26m36.726077666s.",
].join("\n");

const RETRY_REAL =
  "Failed after 3 attempts. Last error: AI_APICallError: [503 Service Unavailable] This model is currently experiencing high demand. " +
  '    at file:///C:/Users/cleom/knowledgedock/node_modules/@ai-sdk/google/dist/index.mjs:479:15\n' +
  "    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)";

describe("humanError", () => {
  it("para cuota, no se queda con la primera línea genérica", () => {
    const out = humanError(new Error(CUOTA_REAL));

    expect(out).toContain("Quota exceeded for metric:");
    expect(out).toContain("limit: 20, model: gemini-3.8-flash");
    expect(out).toContain("Please retry in 20h26m36.726077666s.");
    // La primera línea ("You exceeded your current quota...") es el ruido
    // que queremos descartar.
    expect(out).not.toContain("You exceeded your current quota");
    // La viñeta `* ` no debe colarse en la UI.
    expect(out).not.toMatch(/^\*/);
  });

  it("con errores genéricos se queda con la primera línea", () => {
    const out = humanError(new Error(RETRY_REAL));

    expect(out).toContain("Failed after 3 attempts.");
    expect(out).not.toContain("node:internal/process/task_queues");
  });

  it("nunca devuelve saltos de línea (rompería el evento SSE)", () => {
    expect(humanError(new Error(RETRY_REAL))).not.toMatch(/[\r\n]/);
    expect(humanError(new Error(CUOTA_REAL))).not.toMatch(/[\r\n]/);
    expect(humanError(new Error("uno\r\ndos\r\ntres"))).toBe("uno");
  });

  it("acepta cualquier tipo de valor, no solo Error", () => {
    expect(humanError("boom")).toBe("boom");
    expect(humanError({ code: 429 })).toBe("[object Object]");
  });

  it("recorta los mensajes demasiado largos", () => {
    const out = humanError(new Error("x".repeat(500)));

    expect(out).toHaveLength(300);
    expect(out.endsWith("…")).toBe(true);
  });

  it("con mensaje vacío devuelve algo comprensible", () => {
    expect(humanError(new Error(""))).toBe("Error desconocido del proveedor IA");
    expect(humanError(new Error("\n   \n"))).toBe(
      "Error desconocido del proveedor IA"
    );
  });
});

describe("parseErrorEvent", () => {
  it("desenvuelve el mensaje simple", () => {
    expect(parseErrorEvent("[error: high demand]")).toBe("high demand");
  });

  it("conserva los corchetes del propio mensaje", () => {
    // Regresión: el parser anterior hacía `replace(']', '')`, que se comía el
    // primer corchete y dejaba "[503 Service Unavailable" sin cerrar.
    const msg = "AI_APICallError: [503 Service Unavailable] This model is currently experiencing high demand.";
    expect(parseErrorEvent(`[error: ${msg}]`)).toBe(msg);
  });

  it("devuelve null en los eventos que no son de error", () => {
    expect(parseErrorEvent("[start]")).toBeNull();
    expect(parseErrorEvent("[done]")).toBeNull();
    expect(parseErrorEvent("[context]")).toBeNull();
    expect(parseErrorEvent("hola, ¿qué tal?")).toBeNull();
    expect(
      parseErrorEvent('{"type":"citation","index":1,"source":"a","content":"b"}')
    ).toBeNull();
  });

  it("tolera un evento de error sin el cierre", () => {
    expect(parseErrorEvent("[error: sin cerrar")).toBe("sin cerrar");
  });

  it("un evento de error nunca devuelve null (el fallo se ignoraría)", () => {
    // El cliente hace `if (errMsg !== null) throw ...`: si esto devolviera
    // null, el error se descartaría en silencio — el bug original.
    expect(parseErrorEvent("[error: ]")).toBe("");
    expect(parseErrorEvent("[error: ]")).not.toBeNull();
  });
});
