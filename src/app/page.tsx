'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import UploadDropzone from '@/components/UploadDropzone';
import DocumentList from '@/components/DocumentList';
import SearchBar from '@/components/SearchBar';
import ChatMessage from '@/components/ChatMessage';
import SkeletonLoader from '@/components/SkeletonLoader';
import EmptyState from '@/components/EmptyState';
import ErrorState from '@/components/ErrorState';
import { authClient } from '@/lib/auth-client';

interface DocItem {
  id: string;
  title: string;
  createdAt: string;
}

interface Citation {
  id: string;
  sourceText: string;
  docTitle: string;
}

interface ChatMsg {
  role: 'user' | 'ai';
  content: string;
  citations?: Citation[];
}

export default function Home() {
  const router = useRouter();
  const { data: authSession, isPending: authPending } = authClient.useSession();

  // Documents
  const [documents, setDocuments] = useState<DocItem[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docsError, setDocsError] = useState<string | null>(null);

  // Chat
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [question, setQuestion] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [streamingCitations, setStreamingCitations] = useState<Citation[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);

  // Search
  const [searchResults, setSearchResults] = useState<{ content: string; similarity: number; title: string }[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  // Load private documents only after the session is resolved.
  useEffect(() => {
    if (authPending) return;
    if (!authSession?.user) {
      setDocuments([]);
      setDocsLoading(false);
      return;
    }
    fetchDocuments();
  }, [authPending, authSession?.user.id]);

  async function fetchDocuments() {
    setDocsLoading(true);
    setDocsError(null);
    try {
      const res = await fetch('/api/documents');
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      setDocuments((data.documents ?? []) as DocItem[]);
    } catch (err) {
      setDocsError(err instanceof Error ? err.message : 'Error al cargar documentos');
    } finally {
      setDocsLoading(false);
    }
  }

  async function handleUpload(_doc: { id: string; title: string }) {
    await fetchDocuments();
  }

  async function handleDelete(docId: string) {
    try {
      const res = await fetch(`/api/documents/${docId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      await fetchDocuments();
    } catch (err) {
      setDocsError(err instanceof Error ? err.message : 'Error al borrar');
    }
  }

  async function handleSignOut() {
    const result = await authClient.signOut();
    if (result.error) {
      setChatError(result.error.message ?? 'No se pudo cerrar la sesión.');
      return;
    }
    router.replace('/login');
    router.refresh();
  }

  async function handleAsk(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || chatLoading) return;

    setQuestion('');
    setChatError(null);
    setStreamingText('');
    setStreamingCitations([]);

    // Add user message
    const userMsg: ChatMsg = { role: 'user', content: q };
    setMessages((prev) => [...prev, userMsg]);
    setChatLoading(true);

    try {
      abortRef.current = new AbortController();
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any)?.error?.message ?? `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No stream');

      const decoder = new TextDecoder();
      let buffer = '';
      const citations: Citation[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();

          if (payload === '[start]') continue;
          if (payload === '[done]') continue;
          if (payload.startsWith('[error:')) {
            throw new Error(payload.replace('[error:', '').replace(']', ''));
          }

          if (payload === '[context]') continue;

          try {
            const parsed = JSON.parse(payload) as { type: string; index: number; source: string; content: string };
            if (parsed.type === 'citation') {
              citations.push({
                id: String(parsed.index),
                sourceText: parsed.content,
                docTitle: parsed.source,
              });
              setStreamingCitations([...citations]);
            }
          } catch {
            // Raw text chunk — append to streaming text
            setStreamingText((prev) => prev + payload);
          }
        }
      }

      // Finalize: commit the streaming message
      const aiMsg: ChatMsg = {
        role: 'ai',
        content: streamingText,
        citations,
      };
      setMessages((prev) => [...prev, aiMsg]);
      setStreamingText('');
      setStreamingCitations([]);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Error en la respuesta');
    } finally {
      setChatLoading(false);
      abortRef.current = null;
    }
  }

  function handleSearchCancel() {
    abortRef.current?.abort();
  }

  if (authPending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <p role="status" className="text-sm text-muted-foreground">Comprobando sesión...</p>
      </main>
    );
  }

  if (!authSession?.user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <section className="w-full max-w-lg rounded-xl border border-border bg-background p-8 text-center shadow-sm">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">K</div>
          <h1 className="mt-5 text-2xl font-bold tracking-tight">KnowledgeDock</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Inicia sesión para cargar, buscar y consultar tus documentos privados.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Iniciar sesión o registrarse
          </Link>
        </section>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-sm">
              K
            </div>
            <h1 className="text-lg font-bold tracking-tight text-foreground">KnowledgeDock</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">{authSession.user.email}</span>
            <button
              type="button"
              onClick={handleSignOut}
              className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-6 md:flex-row">
        {/* Left column: Upload + Documents */}
        <aside className="flex flex-col gap-6 md:w-1/3">
          <section>
            <h2 className="mb-3 text-sm font-semibold text-foreground uppercase tracking-wide">Subir Documento</h2>
            <UploadDropzone onUploaded={handleUpload} onError={(msg) => setDocsError(msg)} />
          </section>

          <section className="flex-1">
            <h2 className="mb-3 text-sm font-semibold text-foreground uppercase tracking-wide">Mis Documentos</h2>
            {docsError && <ErrorState message={docsError} onRetry={fetchDocuments} />}
            {docsLoading ? (
              <SkeletonLoader type="list" />
            ) : documents.length === 0 ? (
              <EmptyState
                title="Sin documentos"
                description="Sube un archivo .txt, .md o .pdf para empezar a buscar."
              />
            ) : (
              <DocumentList documents={documents} onDelete={handleDelete} loading={docsLoading} />
            )}
          </section>
        </aside>

        {/* Right column: Chat */}
        <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-background shadow-sm overflow-hidden">
          {/* Chat messages */}
          <div className="flex-1 overflow-y-auto p-4">
            <section className="mb-6 rounded-lg border border-border p-3">
              <h2 className="mb-3 text-sm font-semibold">Búsqueda semántica</h2>
              <SearchBar
                onResults={setSearchResults}
                onLoading={setSearchLoading}
              />
              {searchLoading && (
                <p role="status" className="mt-3 text-sm text-muted-foreground">Buscando en tus documentos...</p>
              )}
              {!searchLoading && searchResults.length > 0 && (
                <ul className="mt-3 flex flex-col gap-2">
                  {searchResults.map((result, index) => (
                    <li key={`${result.title}-${index}`} className="rounded-md bg-muted p-3 text-sm">
                      <p className="mb-1 font-medium">
                        {result.title} · similitud {(result.similarity * 100).toFixed(0)}%
                      </p>
                      <p className="text-muted-foreground">{result.content}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {messages.length === 0 && !chatLoading && (
              <EmptyState
                title="¿Qué necesitas saber?"
                description="Sube tus documentos y hazme una pregunta. Citare las fuentes exactas."
              />
            )}

            {messages.map((msg, i) => (
              <ChatMessage
                key={i}
                role={msg.role}
                content={msg.content}
                citations={msg.citations}
              />
            ))}

            {/* Streaming AI message */}
            {chatLoading && streamingText && (
              <ChatMessage
                role="ai"
                content={streamingText}
                citations={streamingCitations}
                isStreaming
              />
            )}

            {chatError && (
              <div className="mb-4">
                <ErrorState message={chatError} onRetry={() => setChatError(null)} />
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-border p-4 bg-muted/30">
            <form onSubmit={handleAsk} className="flex gap-2">
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Pregunta sobre tus documentos..."
                disabled={chatLoading}
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Escribe tu pregunta"
              />
              <button
                type="submit"
                disabled={chatLoading || !question.trim()}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              >
                {chatLoading ? '...' : 'Enviar'}
              </button>
            </form>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              KnowledgeDock puede cometer errores. Verifica la información importante.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
