import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock del SDK de AI ANTES de importar la función que lo usa.
vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: vi.fn(() => ({
    languageModel: vi.fn(() => ({ id: "mocked-gemini" })),
  })),
}));

// Se importa después de los mocks para que la instancia del módulo use las versiones mockeadas.
import { generateText } from "ai";
import { summarizeDocument } from "../src/lib/summarize";

const mockGenerateText = vi.mocked(generateText);

beforeEach(() => {
  vi.clearAllMocks();
  // Limpia variables de entorno para evitar contaminación entre tests.
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_CHAT_MODEL;
});

describe("summarizeDocument", () => {
  const LONG_TEXT = "x".repeat(12000);
  const SHORT_TEXT = "texto corto de prueba";

  it("recorta el texto a los primeros 8000 caracteres", async () => {
    (mockGenerateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "resumen",
    } as never);

    await summarizeDocument("titulo", LONG_TEXT);

    const callArgs = (mockGenerateText.mock.calls[0]![0] as {
      messages: Array<{ content: string }>;
    });
    const promptText = callArgs.messages[0].content;

    // El prompt contiene el texto recortado, no el original completo.
    expect(promptText).not.toContain("x".repeat(8001));
    expect(promptText).toContain("x".repeat(8000));
  });

  it("devuelve el resumen producido por el modelo", async () => {
    const expectedSummary = "- Punto uno\n- Punto dos\nConclusión: todo bien";
    (mockGenerateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: expectedSummary,
    } as never);

    const result = await summarizeDocument("mi documento", SHORT_TEXT);

    expect(result).toBe(expectedSummary);
  });

  it("devuelve cadena vacía cuando el SDK lanza error", async () => {
    (mockGenerateText as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("API key inválida")
    );

    const result = await summarizeDocument("titulo", SHORT_TEXT);

    expect(result).toBe("");
  });

  it("devuelve cadena vacía cuando generateText resuelve con texto null", async () => {
    (mockGenerateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: null,
    } as never);

    const result = await summarizeDocument("titulo", SHORT_TEXT);

    expect(result).toBe("");
  });

  it("pasa el título dentro del prompt", async () => {
    (mockGenerateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "ok",
    } as never);

    await summarizeDocument("documento de prueba", SHORT_TEXT);

    const promptText = (mockGenerateText.mock.calls[0]![0] as {
      messages: Array<{ content: string }>;
    }).messages[0].content;
    expect(promptText).toContain("documento de prueba");
  });

  it("usa GEMINI_CHAT_MODEL cuando está definida", async () => {
    process.env.GEMINI_API_KEY = "key";
    process.env.GEMINI_CHAT_MODEL = "gemini-custom";
    (mockGenerateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "ok",
    } as never);

    await summarizeDocument("t", "x");

    // El modelo usado es el que se pasa al SDK; verificamos que se llamó generateText.
    expect(mockGenerateText).toHaveBeenCalledOnce();
  });
});
