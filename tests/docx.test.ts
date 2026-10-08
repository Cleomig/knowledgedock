import { beforeEach, describe, expect, it, vi } from "vitest";

const { extractRawText } = vi.hoisted(() => ({
  extractRawText: vi.fn(),
}));

vi.mock("mammoth", () => ({
  default: { extractRawText },
}));

import { extractDocxText } from "../src/lib/docx";

describe("extractDocxText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extrae el texto del documento", async () => {
    const buffer = Buffer.from("docx");
    extractRawText.mockResolvedValue({ value: "Texto del documento" });

    await expect(extractDocxText(buffer)).resolves.toBe("Texto del documento");
    expect(extractRawText).toHaveBeenCalledWith({ buffer });
  });

  it("devuelve null cuando el buffer no es un DOCX válido", async () => {
    extractRawText.mockRejectedValue(new Error("Invalid DOCX"));

    await expect(extractDocxText(Buffer.from("buffer inválido"))).resolves.toBeNull();
  });

  it("no propaga excepciones de mammoth", async () => {
    extractRawText.mockImplementation(() => {
      throw new Error("Extraction failed");
    });

    await expect(extractDocxText(Buffer.from("docx"))).resolves.toBeNull();
  });
});
