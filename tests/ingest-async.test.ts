import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST, GET } from "@/app/api/documents/route";
import * as auth from "@/lib/auth-session";
import * as db from "@/lib/db";
import * as ai from "@/lib/ai";
import * as summarize from "@/lib/summarize";

describe("Ingesta asíncrona con estados", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `clearAllMocks` no descarta las colas `mockResolvedValueOnce` que un
    // test deje sin consumir: sin este reset, los tests siguientes recibirían
    // respuestas residuales de los anteriores.
    vi.mocked(db.query).mockReset();
    vi.mocked(db.execute).mockReset();
    vi.mocked(summarize.summarizeDocument).mockReset();
    afterCallbacks.length = 0;
  });

  // Los factories de `vi.mock` se evalúan antes que el cuerpo del módulo:
  // cualquier estado compartido con ellos DEBE crearse con `vi.hoisted`.
  // (Declararlo con `const` normal hacía que `after()` lanzara
  // "afterCallbacks is not defined" al ejecutar la ruta.)
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

  // El cableado de `summarizeDocument` vive en `after()` y ahora el UPDATE
  // final recibe el resumen como segundo parámetro. Se mockea el módulo
  // completo para no disparar llamadas reales a Gemini desde este test.
  vi.mock("@/lib/summarize", () => ({
    summarizeDocument: vi.fn(),
  }));

  describe("POST /api/documents - ingesta asíncrona", () => {
    beforeEach(() => {
      afterCallbacks.length = 0;
    });

    it("responde inmediatamente con 202 y status 'processing'", async () => {
      vi.mocked(auth.getAuthenticatedUser).mockResolvedValue({ 
        id: "user1", 
        email: "test@test.com", 
        name: "Test" 
      } as unknown as Awaited<ReturnType<typeof auth.getAuthenticatedUser>>);

      vi.mocked(db.query).mockResolvedValue([{ id: "doc-123" }]);

      const req = {
        formData: async () => ({
          get: (key: string) => {
            if (key === "file") return { 
              name: "test.txt", 
              size: 1024, 
              type: "text/plain",
              arrayBuffer: async () => new ArrayBuffer(0)
            };
            if (key === "title") return "Test Document";
            return null;
          }
        })
      } as unknown as Request;

      const res = await POST(req);

      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json).toEqual({
        id: "doc-123",
        title: "Test Document",
        mimeType: "text/plain",
        status: "processing"
      });

      // Verificar que se insertó el documento con status 'processing'
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO documents"),
        ["user1", "Test Document", "text/plain", "processing"]
      );

      // Verificar que se programó trabajo con after()
      expect(afterCallbacks).toHaveLength(1);
    });

    it("ejecuta el trabajo pesado en after() y actualiza status a 'ready'", async () => {
      vi.mocked(auth.getAuthenticatedUser).mockResolvedValue({ 
        id: "user1", 
        email: "test@test.com", 
        name: "Test" 
      } as unknown as Awaited<ReturnType<typeof auth.getAuthenticatedUser>>);

      vi.mocked(db.query)
        .mockResolvedValueOnce([{ id: "doc-123" }]) // Para el INSERT
        .mockResolvedValueOnce([{ id: "doc-123" }]); // Para el mock del after

      const embedBatch = vi.fn().mockResolvedValue([
        { vector: [0.1, 0.2, 0.3] },
        { vector: [0.4, 0.5, 0.6] }
      ]);
      vi.mocked(ai.getAiProvider).mockReturnValue({
        embedBatch
      } as unknown as ReturnType<typeof ai.getAiProvider>);

      vi.mocked(summarize.summarizeDocument).mockResolvedValue("Resumen de prueba");

      const req = {
        formData: async () => ({
          get: (key: string) => {
            if (key === "file") return { 
              name: "test.txt", 
              size: 1024, 
              type: "text/plain",
              arrayBuffer: async () => new TextEncoder().encode("Texto de prueba para chunking").buffer
            };
            return null;
          }
        })
      } as unknown as Request;

      // Ejecutar POST para registrar el callback
      await POST(req);
      
      // Ejecutar manualmente el callback de after()
      expect(afterCallbacks).toHaveLength(1);
      await afterCallbacks[0]();

      // Verificar que se llamó a embedBatch
      expect(embedBatch).toHaveBeenCalledWith(
        expect.any(Array),
        { taskType: "retrieval_document" }
      );

      // Verificar que se actualizó el estado a 'ready' guardando el resumen
      expect(db.execute).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE documents SET status = 'ready'"),
        ["doc-123", "Resumen de prueba"]
      );
    });

    it("actualiza status a 'failed' cuando el texto está vacío", async () => {
      vi.mocked(auth.getAuthenticatedUser).mockResolvedValue({ 
        id: "user1", 
        email: "test@test.com", 
        name: "Test" 
      } as unknown as Awaited<ReturnType<typeof auth.getAuthenticatedUser>>);

      vi.mocked(db.query)
        .mockResolvedValueOnce([{ id: "doc-123" }]) // Para el INSERT
        .mockResolvedValueOnce([{ id: "doc-123" }]); // Para el mock del after

      const req = {
        formData: async () => ({
          get: (key: string) => {
            if (key === "file") return { 
              name: "empty.txt", 
              size: 1024, 
              type: "text/plain",
              arrayBuffer: async () => new TextEncoder().encode("   ").buffer
            };
            return null;
          }
        })
      } as unknown as Request;

      // Ejecutar POST para registrar el callback
      await POST(req);
      
      // Ejecutar manualmente el callback de after()
      expect(afterCallbacks).toHaveLength(1);
      await afterCallbacks[0]();

      // Verificar que se actualizó el estado a 'failed' con mensaje apropiado
      expect(db.execute).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE documents SET status = 'failed'"),
        ["doc-123", "El documento no contiene texto extraíble"]
      );
    });

    it("actualiza status a 'failed' cuando hay error en embeddings", async () => {
      vi.mocked(auth.getAuthenticatedUser).mockResolvedValue({ 
        id: "user1", 
        email: "test@test.com", 
        name: "Test" 
      } as unknown as Awaited<ReturnType<typeof auth.getAuthenticatedUser>>);

      vi.mocked(db.query)
        .mockResolvedValueOnce([{ id: "doc-123" }]) // Para el INSERT
        .mockResolvedValueOnce([{ id: "doc-123" }]); // Para el mock del after

      const embedBatch = vi.fn().mockRejectedValue(new Error("Error de embeddings"));
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
            return null;
          }
        })
      } as unknown as Request;

      // Ejecutar POST para registrar el callback
      await POST(req);
      
      // Ejecutar manualmente el callback de after()
      expect(afterCallbacks).toHaveLength(1);
      await afterCallbacks[0]();

      // Verificar que se actualizó el estado a 'failed' con el error
      expect(db.execute).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE documents SET status = 'failed'"),
        ["doc-123", "Error de embeddings"]
      );
    });

    it("mantiene validaciones en línea (tamaño de archivo)", async () => {
      vi.mocked(auth.getAuthenticatedUser).mockResolvedValue({ 
        id: "user1", 
        email: "test@test.com", 
        name: "Test" 
      } as unknown as Awaited<ReturnType<typeof auth.getAuthenticatedUser>>);

      const req = {
        formData: async () => ({
          get: (key: string) => {
            if (key === "file") return { 
              name: "huge.pdf", 
              size: 5 * 1024 * 1024, // 5 MB > límite
              type: "application/pdf",
              arrayBuffer: async () => new ArrayBuffer(0)
            };
            return null;
          }
        })
      } as unknown as Request;

      const res = await POST(req);
      
      expect(res.status).toBe(413);
      const json = await res.json();
      expect(json.error.code).toBe("MAX_FILE_SIZE");
      
      // No debería haber llamado a after()
      expect(afterCallbacks).toHaveLength(0);
    });

    it("mantiene validaciones en línea (tipo no soportado)", async () => {
      vi.mocked(auth.getAuthenticatedUser).mockResolvedValue({ 
        id: "user1", 
        email: "test@test.com", 
        name: "Test" 
      } as unknown as Awaited<ReturnType<typeof auth.getAuthenticatedUser>>);

      const req = {
        formData: async () => ({
          get: (key: string) => {
            if (key === "file") return { 
              name: "image.jpg", 
              size: 1024, 
              type: "image/jpeg",
              arrayBuffer: async () => new ArrayBuffer(0)
            };
            return null;
          }
        })
      } as unknown as Request;

      const res = await POST(req);
      
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("UNSUPPORTED_TYPE");
      
      // No debería haber llamado a after()
      expect(afterCallbacks).toHaveLength(0);
    });
  });

  describe("GET /api/documents - incluye status y error", () => {
    it("devuelve status y error para cada documento", async () => {
      vi.mocked(auth.getAuthenticatedUser).mockResolvedValue({ 
        id: "user1", 
        email: "test@test.com", 
        name: "Test" 
      } as unknown as Awaited<ReturnType<typeof auth.getAuthenticatedUser>>);

      const mockDocuments = [
        { id: "doc1", title: "Documento 1", mime_type: "text/plain", created_at: new Date(), status: "ready", error: null },
        { id: "doc2", title: "Documento 2", mime_type: "application/pdf", created_at: new Date(), status: "failed", error: "Error de extracción" },
        { id: "doc3", title: "Documento 3", mime_type: "text/plain", created_at: new Date(), status: "processing", error: null },
      ];

      vi.mocked(db.query).mockResolvedValue(mockDocuments);

      const req = {} as Request;
      const res = await GET(req);
      
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.documents).toHaveLength(3);
      expect(json.documents[0].status).toBe("ready");
      expect(json.documents[0].error).toBeNull();
      expect(json.documents[1].status).toBe("failed");
      expect(json.documents[1].error).toBe("Error de extracción");
      expect(json.documents[2].status).toBe("processing");
    });

    it("actualiza documentos 'processing' con más de 5 minutos a 'failed'", async () => {
      vi.mocked(auth.getAuthenticatedUser).mockResolvedValue({ 
        id: "user1", 
        email: "test@test.com", 
        name: "Test" 
      } as unknown as Awaited<ReturnType<typeof auth.getAuthenticatedUser>>);

      const mockDocuments = [
        { id: "doc1", title: "Documento 1", mime_type: "text/plain", created_at: new Date(), status: "ready", error: null },
      ];

      vi.mocked(db.query).mockResolvedValue(mockDocuments);

      const req = {} as Request;
      await GET(req);
      
      // Verificar que se ejecutó la transición anti-stuck. La SQL del
      // watchdog es multi-línea, así que se asertan subcadenas de una
      // misma línea (no cruces de salto).
      expect(db.execute).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'failed', error = 'Procesamiento agotado'"),
        ["user1"]
      );
    });
  });
});