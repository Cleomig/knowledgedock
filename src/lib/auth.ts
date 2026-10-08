import { betterAuth } from "better-auth";
import { getPool } from "@/lib/db";

const secret = process.env.BETTER_AUTH_SECRET;

if (!secret) {
  throw new Error("BETTER_AUTH_SECRET no está configurado.");
}

export const auth = betterAuth({
  appName: "KnowledgeDock",
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
  basePath: "/api/auth",
  secret,
  database: getPool(),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
});
