import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/documents/route";
import * as auth from "@/lib/auth-session";
import * as db from "@/lib/db";
import * as ai from "@/lib/ai";
import * as summarize from "@/lib/summarize";

describe("Cableado de summarizeDocument", () => {
  const afterCallbacks = vi.hoisted(() => [] as (() => Promise<void>)[]);

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

  vi.mock("@/lib/db", () => ({
    query: vi.fn(),
    execute: vi.fn(),
  }));

  vi.mock("@/lib/auth-session", () => ({
    getAuthenticatedUser: vi.fn(),
    unauthorizedResponse: vi.fn(() => new Response("Unauthorized", { status: 401 })),
  }));

  vi.mock("@/lib/ai", () => ({
    getAiProvider: vi.fn(),
  }));

  vi.mock("@/lib/summarize", () => ({
    summarizeDocument: vi.fn(),
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.query).mockReset();
    vi.mocked(db.execute).mockReset();
    vi.mocked(summarize.summarizeDocument).mockReset();
    afterCallbacks.length = 0;
  });

  const setupMocks = () => {
    vi.mocked(auth.getAuthenticatedUser).mockResolvedValue({ 
      id: "user1", 
      email: "test@test.com", 
      name: "Test" 
    } as unknown as Awaited<ReturnType<typeof auth.getAuthenticatedUser>>);

    vi.mocked(db.query)
      .mockResolvedValueOnce([{ id: "doc-123" }])
      .mockResolvedValueOnce([{ id: "doc-123" }]);

    const embedBatch = vi.fn().mockResolvedValue([
      { vector: [0.1, 0.2, 0.3] }
    ]);
    vi.mocked(ai.getAiProvider).mockReturnValue({
      embedBatch
    } as unknown as ReturnType<typeof ai.getAiProvider>);

    const req = {
      formData: async () => ({
        get: (key: string) => {
          if (key === "file") return { 
            name: "test.txt", 
            size: 1024, 
            type: "text/plain",
            arrayBuffer: async () => new TextEncoder().encode("Texto de prueba").buffer
          };
          if (key === "title") return "Test Document";
          return null;
        }
      })
    } as unknown as Request;

    return req;
  };

  it("Caso éxito: actualiza status a 'ready' y guarda el resumen", async () => {
    const req = setupMocks();
    vi.mocked(summarize.summarizeDocument).mockResolvedValue("Resumen generado exitosamente");

    await POST(req);
    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]();

    expect(summarize.summarizeDocument).toHaveBeenCalledWith("Test Document", "Texto de prueba");
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE documents SET status = 'ready', error = NULL, summary = $2 WHERE id = $1"),
      ["doc-123", "Resumen generado exitosamente"]
    );
  });

  it("Caso summarize vacío: actualiza status a 'ready' con summary nulo", async () => {
    const req = setupMocks();
    vi.mocked(summarize.summarizeDocument).mockResolvedValue("   ");

    await POST(req);
    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]();

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE documents SET status = 'ready', error = NULL, summary = $2 WHERE id = $1"),
      ["doc-123", null]
    );
  });

  it("Caso summarize que rechaza: actualiza status a 'ready' con summary nulo", async () => {
    const req = setupMocks();
    vi.mocked(summarize.summarizeDocument).mockRejectedValue(new Error("Timeout en Gemini"));

    await POST(req);
    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]();

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE documents SET status = 'ready', error = NULL, summary = $2 WHERE id = $1"),
      ["doc-123", null]
    );
  });
});
