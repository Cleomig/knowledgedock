import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export async function getAuthenticatedUser(request: Request) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  return session?.user ?? null;
}

export function unauthorizedResponse() {
  return NextResponse.json(
    { error: { code: "UNAUTHORIZED", message: "Debes iniciar sesión." } },
    { status: 401 }
  );
}
