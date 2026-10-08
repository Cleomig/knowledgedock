import { NextResponse } from "next/server";
import { query, execute } from "@/lib/db";
import { getAuthenticatedUser, unauthorizedResponse } from "@/lib/auth-session";

interface UserSettingsRow {
  email: string;
  notify_email: boolean;
}

/** GET /api/settings — Devuelve el email y la preferencia de notificaciones del usuario. */
export async function GET(req: Request) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return unauthorizedResponse();

    const rows = await query<UserSettingsRow>(
      `SELECT email, notify_email FROM "user" WHERE id = $1`,
      [user.id]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Usuario no encontrado." } },
        { status: 404 }
      );
    }

    return NextResponse.json({
      email: rows[0].email,
      notifyEmail: rows[0].notify_email,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: msg } }, { status: 500 });
  }
}

/** PUT /api/settings — Actualiza la preferencia de notificaciones por email. */
export async function PUT(req: Request) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return unauthorizedResponse();

    const body = await req.json();
    const notifyEmail = body.notifyEmail;

    if (typeof notifyEmail !== "boolean") {
      return NextResponse.json(
        { error: { code: "INVALID_BODY", message: "notifyEmail debe ser boolean." } },
        { status: 400 }
      );
    }

    await execute(
      `UPDATE "user" SET notify_email = $2, "updatedAt" = now() WHERE id = $1`,
      [user.id, notifyEmail]
    );

    return NextResponse.json({ ok: true, notifyEmail });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: msg } }, { status: 500 });
  }
}
