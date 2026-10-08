import { describe, expect, it } from "vitest";
import { joinSegments, parseCitationMarkers } from "@/lib/chat/citations";

describe("parseCitationMarkers", () => {
  it("devuelve vacío para texto sin referencias", () => {
    expect(parseCitationMarkers("")).toEqual([]);
    expect(parseCitationMarkers("hola, ¿qué tal?")).toEqual([
      { kind: "text", text: "hola, ¿qué tal?" },
    ]);
  });

  it("aisla una referencia simple", () => {
    expect(parseCitationMarkers("Según el documento [3] corto.")).toEqual([
      { kind: "text", text: "Según el documento " },
      { kind: "markers", numbers: [3], raw: "[3]" },
      { kind: "text", text: " corto." },
    ]);
  });

  it("reconoce grupos de varias referencias", () => {
    expect(parseCitationMarkers("Bienvenido [3, 5].")).toEqual([
      { kind: "text", text: "Bienvenido " },
      { kind: "markers", numbers: [3, 5], raw: "[3, 5]" },
      { kind: "text", text: "." },
    ]);
  });

  it("acepta espacios y faltas de espacio en el separador", () => {
    for (const [raw, numbers] of [
      ["[3,5]", [3, 5]],
      ["[ 3 , 5 ]", [3, 5]],
      ["[ 2 ]", [2]],
    ] as const) {
      const [, markers] = parseCitationMarkers(`x${raw}y`);
      expect(markers).toEqual({ kind: "markers", numbers: [...numbers], raw });
    }
  });

  it("sirve para varios marcadores en la misma frase", () => {
    const segments = parseCitationMarkers("[2] y también [11] fin");
    const markers = segments.filter((s) => s.kind === "markers");
    expect(markers).toEqual([
      { kind: "markers", numbers: [2], raw: "[2]" },
      { kind: "markers", numbers: [11], raw: "[11]" },
    ]);
  });

  it("acepta referencias de varios dígitos", () => {
    expect(parseCitationMarkers("[12]")).toEqual([
      { kind: "markers", numbers: [12], raw: "[12]" },
    ]);
  });

  it("no confunde otros corchetes con referencias de cita", () => {
    // Sintaxis de Markdown, listas y texto libre: sin número no hay cita.
    for (const text of ["[hola]", "[]", "[a, b]", "[3a]", "texto [ ] mas"]) {
      expect(parseCitationMarkers(text)).toEqual([
        { kind: "text", text },
      ]);
    }
  });

  it("no pierde ni reescribe ni un carácter (redondo completo)", () => {
    const samples = [
      "",
      "texto plano",
      "[1]",
      "Bienvenido a Okane Barbershop [3, 5]. ¿En qué puedo ayudarte? [2]",
      "pref[1]med[2]suf",
      "[hola] y [3] y []",
      "corchetes [[4]] anidados",
      "varias\nlíneas\ncon [7]",
    ];

    for (const sample of samples) {
      expect(joinSegments(parseCitationMarkers(sample))).toBe(sample);
    }
  });

  it("sigue reconociendo referencias aunque el texto anterior no sea JSON", () => {
    // Regresión de doble camino: el SSE también suelta JSON que no es cita
    // y ese texto puede contener referencias.
    const segments = parseCitationMarkers('{"a":1} y luego [4]');
    expect(segments[segments.length - 1]).toEqual({
      kind: "markers",
      numbers: [4],
      raw: "[4]",
    });
  });
});
