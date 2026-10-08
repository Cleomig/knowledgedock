import { NextResponse } from "next/server";
import { query, execute } from "@/lib/db";

/** DELETE /api/documents/[id] — Borra documento y sus chunks */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Validar UUID
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ error: { code: "INVALID_ID", message: "ID de documento inválido" } }, { status: 400 });
    }

    // Borrar chunks primero (CASCADE lo haría, pero somos explícitos)
    await execute("DELETE FROM chunks WHERE document_id = $1", [id]);
    const affected = await execute("DELETE FROM documents WHERE id = $1", [id]);

    if (affected === 0) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Documento no encontrado" } }, { status: 404 });
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: msg } }, { status: 500 });
  }
}
