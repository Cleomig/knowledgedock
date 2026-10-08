import Link from "next/link";
import AuthForm from "@/components/AuthForm";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <section className="w-full max-w-md rounded-xl border border-border bg-background p-8 shadow-sm">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← KnowledgeDock
        </Link>
        <h1 className="mt-6 text-2xl font-bold tracking-tight">Tu espacio de documentos</h1>
        <p className="mb-6 mt-2 text-sm text-muted-foreground">
          Inicia sesión o crea una cuenta para acceder a tus documentos privados.
        </p>
        <AuthForm />
      </section>
    </main>
  );
}
