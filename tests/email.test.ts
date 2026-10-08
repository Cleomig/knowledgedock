import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock de Resend ANTES de importar email.ts
const mockSend = vi.fn();
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: mockSend },
  })),
}));

describe("sendDocumentEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.EMAIL_FROM = "Test <test@resend.dev>";
  });

  it("envía email de éxito con asunto y resumen", async () => {
    mockSend.mockResolvedValue({ data: { id: "email_123" }, error: null });
    const { sendDocumentEmail } = await import("@/lib/email");

    await sendDocumentEmail({
      to: "user@test.com",
      title: "doc.txt",
      status: "ready",
      summary: "Este es el resumen",
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const arg = mockSend.mock.calls[0][0];
    expect(arg.to).toBe("user@test.com");
    expect(arg.from).toBe("Test <test@resend.dev>");
    expect(arg.subject).toContain("doc.txt");
    expect(arg.subject).toContain("listo");
    expect(arg.text).toContain("Este es el resumen");
    expect(arg.html).toContain("Este es el resumen");
  });

  it("envía email de error con el mensaje", async () => {
    mockSend.mockResolvedValue({ data: { id: "email_456" }, error: null });
    const { sendDocumentEmail } = await import("@/lib/email");

    await sendDocumentEmail({
      to: "user@test.com",
      title: "roto.pdf",
      status: "failed",
      error: "El documento no contiene texto extraíble",
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const arg = mockSend.mock.calls[0][0];
    expect(arg.subject).toContain("roto.pdf");
    expect(arg.subject).toContain("Error");
    expect(arg.text).toContain("no contiene texto extraíble");
    expect(arg.html).toContain("no contiene texto extraíble");
  });

  it("lanza si Resend devuelve error", async () => {
    mockSend.mockResolvedValue({ data: null, error: { message: "Invalid API key" } });
    const { sendDocumentEmail } = await import("@/lib/email");

    await expect(
      sendDocumentEmail({ to: "x@y.z", title: "t", status: "ready" })
    ).rejects.toThrow("Invalid API key");
  });

  it("escapa HTML en el título y el resumen", async () => {
    mockSend.mockResolvedValue({ data: { id: "e" }, error: null });
    const { sendDocumentEmail } = await import("@/lib/email");

    await sendDocumentEmail({
      to: "user@test.com",
      title: '<script>alert("xss")</script>.txt',
      status: "ready",
      summary: '<img src=x onerror=alert(1)>',
    });

    const arg = mockSend.mock.calls[0][0];
    expect(arg.html).not.toContain("<script>");
    expect(arg.html).not.toContain("<img src=x");
    expect(arg.html).toContain("&lt;script&gt;");
    expect(arg.text).toContain('<script>alert("xss")</script>.txt');
  });
});
