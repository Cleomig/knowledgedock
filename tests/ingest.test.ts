import { describe, it, expect, vi, beforeEach } from "vitest";
import { GeminiProvider } from "@/lib/ai/gemini";
import * as ai from "ai";
import { POST } from "@/app/api/documents/route";
import * as auth from "@/lib/auth-session";

// Mock de after para los tests
const afterCallbacks: (() => Promise<void>)[] = [];
vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => {
      return new Response(JSON.stringify(body), {
        status: init?.status || 200,
        headers: { "content-type": "application/json" }
      });
    }),
  },
  after: vi.fn((callback: () => Promise<void>) => {
    afterCallbacks.push(callback);
  }),
}));

vi.mock("ai", async (importOriginal) => {
  const mod = await importOriginal<typeof import("ai")>();
  return {
    ...mod,
    embedMany: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthenticatedUser: vi.fn(),
  unauthorizedResponse: vi.fn(() => new Response("Unauthorized", { status: 401 })),
}));

describe("Ingestión y Embeddings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    afterCallbacks.length = 0;
  });

  describe("GeminiProvider embedBatch", () => {
    it("pagina los textos en lotes y reintenta si un lote falla", async () => {
      const provider = new GeminiProvider({ GEMINI_API_KEY: "test" } as unknown as NodeJS.ProcessEnv);
      
      const texts = Array.from({ length: 120 }, (_, i) => `texto ${i}`);
      const embedManyMock = vi.mocked(ai.embedMany);
      
      let callCount = 0;
      embedManyMock.mockImplementation(async ({ values }) => {
        callCount++;
        const valArray = values as string[];
        // Simulamos un fallo en la primera llamada del segundo lote
        if (valArray.length === 50 && callCount === 2) {
          throw new Error("Error transitorio");
        }
        return {
          embeddings: valArray.map(() => [0.1, 0.2, 0.3]),
        } as unknown as ReturnType<typeof ai.embedMany>;
      });

      const results = await provider.embedBatch(texts);
      
      expect(results).toHaveLength(120);
      expect(embedManyMock).toHaveBeenCalledTimes(4); // 3 lotes + 1 reintento
    });

    it("lanza un error claro si el lote falla tras el reintento", async () => {
      const provider = new GeminiProvider({ GEMINI_API_KEY: "test" } as unknown as NodeJS.ProcessEnv);
      const texts = ["texto 1", "texto 2"];
      const embedManyMock = vi.mocked(ai.embedMany);
      
      embedManyMock.mockRejectedValue(new Error("Error fatal"));

      await expect(provider.embedBatch(texts)).rejects.toThrow(
        /Falló el lote de embeddings \(textos 0 a 1\) tras reintentar: Error fatal/
      );
      
      expect(embedManyMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("Endpoint POST /api/documents", () => {
    it("rechaza archivos por tamaño > 4 MB con 413 MAX_FILE_SIZE", async () => {
      vi.mocked(auth.getAuthenticatedUser).mockResolvedValue({ 
        id: "user1", 
        email: "test@test.com", 
        name: "Test" 
      } as unknown as Awaited<ReturnType<typeof auth.getAuthenticatedUser>>);
      
      const req = {
        formData: async () => ({
          get: (key: string) => {
            if (key === "file") return { name: "large.txt", size: 5 * 1024 * 1024 };
            return null;
          }
        })
      } as unknown as Request;
      
      const res = await POST(req);
      
      expect(res.status).toBe(413);
      const json = await res.json();
      expect(json.error.code).toBe("MAX_FILE_SIZE");
    });
  });
});
