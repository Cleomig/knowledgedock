import { describe, expect, it } from "vitest";
import { parseStreamEvent } from "@/lib/chat/sse";

describe("parseStreamEvent", () => {
  it("ignora los marcadores de control", () => {
    for (const m of ["[start]", "[done]", "[context]"]) {
      expect(parseStreamEvent(m)).toEqual({ kind: "skip" });
    }
  });

  it("detecta el error del envoltorio [error: ...]", () => {
    const msg = "AI_APICallError: [503 Service Unavailable] high demand";
    expect(parseStreamEvent(`[error: ${msg}]`)).toEqual({
      kind: "error",
      message: msg,
    });
  });

  it("detecta también el error que llega en JSON", () => {
    expect(
      parseStreamEvent('{"type":"error","message":"cuota agotada"}')
    ).toEqual({ kind: "error", message: "cuota agotada" });
  });

  it("extrae la cita con sus tres campos", () => {
    const payload = JSON.stringify({
      type: "citation",
      index: 3,
      source: "TAREA.txt",
      content: "fragmento recuperado",
    });

    expect(parseStreamEvent(payload)).toEqual({
      kind: "citation",
      citation: {
        id: "3",
        sourceText: "fragmento recuperado",
        docTitle: "TAREA.txt",
      },
    });
  });

  it("cualquier texto plano se devuelve como texto", () => {
    expect(parseStreamEvent("hola, ¿qué tal?")).toEqual({
      kind: "text",
      text: "hola, ¿qué tal?",
    });
    expect(parseStreamEvent("")).toEqual({ kind: "text", text: "" });
  });

  it("REGRESIÓN: JSON válido que no es una cita NO se descarta", () => {
    // Antes se hacía JSON.parse y, si parseaba pero no era una cita, el
    // trozo se tiraba en silencio. Un modelo que emitiera "123" o "true"
    // perdía texto sin aviso.
    for (const payload of ["123", "true", "false", "null", '{"a":1}', '"hola"']) {
      expect(parseStreamEvent(payload)).toEqual({
        kind: "text",
        text: payload,
      });
    }
  });

  it("una cadena que empiece igual que un marcador pero no lo sea es texto", () => {
    expect(parseStreamEvent("[done]mentario del usuario")).toEqual({
      kind: "text",
      text: "[done]mentario del usuario",
    });
  });
});
