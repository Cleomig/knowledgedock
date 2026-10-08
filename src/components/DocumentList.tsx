'use client';

import { FileText, Loader2, Trash2 } from 'lucide-react';
import DocumentErrorHint, { type ErrorCode } from './DocumentErrorHint';

interface DocumentItem {
  id: string;
  title: string;
  createdAt: string;
  status?: 'processing' | 'ready' | 'failed' | string;
  error?: string | null;
  errorCode?: ErrorCode | null;
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

        const hasError = doc.status === 'failed' && !!doc.error;
        const errorCode: ErrorCode | null =
          doc.errorCode ?? (hasError ? extractCodeFromMessage(doc.error!) : null);
        const userFriendlyMsg: string | null = hasError ? doc.error! : null;

        return (
          <div
            key={doc.id}
            className={`group flex flex-col rounded-xl border transition-colors hover:bg-muted/50 ${
              hasError
                ? 'border-amber-200 bg-amber-50/30 dark:border-amber-900/40 dark:bg-amber-950/10'
                : 'border-border'
            }`}
          >
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    hasError
                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                      : 'bg-primary/5 text-primary'
                  }`}
                >
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
                    {hasError && (
                      <span
                        className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                        title={userFriendlyMsg ?? 'El procesamiento falló'}
                      >
                        {errorCode === 'PDF_SCANNED' && 'PDF escaneado'}
                        {errorCode === 'PDF_EMPTY' && 'PDF vacío'}
                        {errorCode === 'DOCX_EMPTY' && 'Word vacío'}
                        {errorCode === 'TEXT_EMPTY' && 'Archivo vacío'}
                        {errorCode === 'EMBEDDING_FAILED' && 'Embedding falló'}
                        {errorCode === 'PROCESSING_TIMEOUT' && 'Tiempo agotado'}
                        {!errorCode && 'Error'}
                      </span>
                    )}
                  </div>
                  {summaryText && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground" title={summaryText}>
                      {summaryText}
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

            {hasError && (
              <DocumentErrorHint errorCode={errorCode} errorMessage={userFriendlyMsg} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Intenta extraer un código de error del mensaje cuando no viene explícito.
 * Esto cubre el caso de documentos antiguos que aún no tienen error_code en BD.
 */
function extractCodeFromMessage(msg: string): ErrorCode | null {
  if (!msg) return null;
  const lower = msg.toLowerCase();
  if (lower.includes('escaneado') || lower.includes('ocr')) return 'PDF_SCANNED';
  if (lower.includes('pdf') && lower.includes('vacío')) return 'PDF_EMPTY';
  if (lower.includes('pdf') && lower.includes('extraíble')) return 'PDF_EMPTY';
  if (lower.includes('word') && lower.includes('texto')) return 'DOCX_EMPTY';
  if (lower.includes('vacío') || lower.includes('empty')) return 'TEXT_EMPTY';
  if (lower.includes('embedding')) return 'EMBEDDING_FAILED';
  if (lower.includes('agotado') || lower.includes('timeout')) return 'PROCESSING_TIMEOUT';
  return null;
}
