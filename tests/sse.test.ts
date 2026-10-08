import { describe, expect, it } from "vitest";
import { parseStreamEvent, SSEDecoder } from "@/lib/chat/sse";

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

describe("SSEDecoder", () => {
  it("reparte y vuelve a unir un payload con saltos de línea", () => {
    // Formato EXACTO que emite /api/ask para un trozo de texto multilínea.
    const wire = [
      "data: [start]",
      "",
      "data: Los documentos disponibles",
      "data: 1. **TAREA.txt** [1], [4]",
      "data: 2. **chat.txt**",
      "",
      "data: [done]",
      "",
      // La línea vacía final CIERRA el evento: sin ella `[done]` queda
      // pendiente en el decoder (SSE despacha al recibirla).
      "",
    ].join("\n");

    expect(new SSEDecoder().push(wire)).toEqual([
      "[start]",
      "Los documentos disponibles\n1. **TAREA.txt** [1], [4]\n2. **chat.txt**",
      "[done]",
    ]);
  });

  it("REGRESIÓN: sin repartir, la continuación queda huérfana y se pierde", () => {
    // Con el formato viejo (`data: ${text}\n\n` en una sola línea) la línea
    // "segunda línea" llegaba sin prefijo y el bucle la descartaba: la
    // respuesta salía cortada justo en el primer salto de línea.
    //
    // De ahí que el arreglo tiene que ser TAMBIÉN en el servidor: la
    // especificación SSE ignora una línea sin `data:`, así que el cliente
    // por sí solo no puede recuperar lo perdido.
    expect(new SSEDecoder().push("data: primera línea\nsegunda línea\n\n")).toEqual([
      "primera línea",
    ]);
    expect(
      new SSEDecoder().push("data: primera línea\ndata: segunda línea\n\n")
    ).toEqual(["primera línea\nsegunda línea"]);
  });

  it("reensambla eventos partidos entre trozos de red", () => {
    const dec = new SSEDecoder();
    expect(dec.push("data: ho")).toEqual([]);
    expect(dec.push("la\n")).toEqual([]);
    expect(dec.push("\n")).toEqual(["hola"]);
    // Un evento sin línea vacía final sigue pendiente: SSE no lo cierra.
    expect(dec.push("data: otro\n")).toEqual([]);
  });

  it("ignora campos que no son data: y comentarios", () => {
    const wire = "event: ping\nid: 7\nretry: 100\n: comentario\ndata: x\n\n";
    expect(new SSEDecoder().push(wire)).toEqual(["x"]);
  });

  it("admite finales de línea \\r\\n", () => {
    expect(new SSEDecoder().push("data: hola\r\n\r\n")).toEqual(["hola"]);
  });

  it("conserva los espacios exactos del texto del modelo", () => {
    // Un `trim()` aquí se comía el espacio inicial de " son:" y degradaba la
    // lectura al concatenar los trozos.
    expect(new SSEDecoder().push("data:  son:\n\n")).toEqual([" son:"]);
  });
});
