'use client';

import { FileText, Loader2, Trash2 } from 'lucide-react';

interface DocumentItem {
  id: string;
  title: string;
  createdAt: string;
  status?: 'processing' | 'ready' | 'failed' | string;
  error?: string | null;
  summary?: string | null;
}

interface DocumentListProps {
  documents: DocumentItem[];
  onDelete?: (id: string) => Promise<void>;
  loading?: boolean;
}

export default function DocumentList({ documents, onDelete, loading }: DocumentListProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-3 animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl border border-border bg-background p-4">
            <div className="h-10 w-10 rounded-lg bg-muted" />
            <div className="flex flex-col gap-2 flex-1">
              <div className="h-4 w-3/4 rounded bg-muted" />
              <div className="h-3 w-1/3 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!documents || documents.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {documents.map((doc) => {
        const summaryText =
          doc.status === 'ready' && typeof doc.summary === 'string' && doc.summary.trim().length > 0
            ? doc.summary.trim()
            : null;

        return (
          <div
            key={doc.id}
            className="group flex items-center justify-between rounded-xl border border-border bg-background p-4 transition-colors hover:border-primary/20 hover:bg-muted/50"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/5 text-primary">
                <FileText className="h-4 w-4 shrink-0" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{doc.title}</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="truncate">{doc.createdAt}</span>
                  {doc.status === 'processing' && (
                    <span role="status" className="inline-flex shrink-0 items-center gap-1 text-amber-600">
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                      Procesando…
                    </span>
                  )}
                  {doc.status === 'failed' && (
                    <span
                      className="shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 font-medium text-destructive"
                      title={doc.error ?? 'El procesamiento falló'}
                    >
                      Error
                    </span>
                  )}
                </div>
                {summaryText && (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground" title={summaryText}>
                    {summaryText}
                  </p>
                )}
                {doc.status === 'failed' && doc.error && (
                  <p className="mt-1 truncate text-xs text-destructive/80" title={doc.error}>
                    {doc.error}
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={() => onDelete?.(doc.id)}
              className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label={`Borrar ${doc.title}`}
              title="Borrar documento"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
