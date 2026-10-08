import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "KnowledgeDock",
    template: "%s · KnowledgeDock",
  },
  description:
    "Búsqueda semántica sobre tus documentos: sube archivos, pregunta en lenguaje natural y recibe respuestas con citas a los fragmentos de origen.",
  keywords: ["RAG", "búsqueda semántica", "pgvector", "Gemini", "Next.js"],
  openGraph: {
    title: "KnowledgeDock",
    description:
      "Búsqueda semántica sobre tus documentos con respuestas citadas.",
    type: "website",
    locale: "es_ES",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
