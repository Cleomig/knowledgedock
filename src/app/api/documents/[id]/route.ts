import { NextResponse } from "next/server";
import { query, execute } from "@/lib/db";
import { getAuthenticatedUser, unauthorizedResponse } from "@/lib/auth-session";

/** DELETE /api/documents/[id] — Borra documento y sus chunks */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return unauthorizedResponse();

    const { id } = await params;

    // Validar UUID
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ error: { code: "INVALID_ID", message: "ID de documento inválido" } }, { status: 400 });
    }

    const documents = await query<{ owner_id: string }>(
      "SELECT owner_id FROM documents WHERE id = $1",
      [id]
    );

    if (documents.length === 0) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Documento no encontrado" } }, { status: 404 });
    }

    if (documents[0].owner_id !== user.id) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "No tienes acceso a este documento." } }, { status: 403 });
    }

    // La FK document_id borra sus chunks en cascada.
    const affected = await execute(
      "DELETE FROM documents WHERE id = $1 AND owner_id = $2",
      [id, user.id]
    );
    if (affected === 0) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Documento no encontrado" } }, { status: 404 });
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: msg } }, { status: 500 });
  }
}
