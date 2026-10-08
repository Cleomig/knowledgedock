'use client';

import { useState } from 'react';
import { AlertCircle, Lightbulb, X, FileText, FileUp } from 'lucide-react';

/** Códigos de error soportados */
export type ErrorCode =
  | 'PDF_SCANNED'
  | 'PDF_EMPTY'
  | 'DOCX_EMPTY'
  | 'TEXT_EMPTY'
  | 'EMBEDDING_FAILED'
  | 'PROCESSING_TIMEOUT'
  | string;

export interface DocumentErrorHintProps {
  errorCode: ErrorCode | null;
  errorMessage: string | null;
}

/** Icono según el tipo de error */
function ErrorIcon({ code }: { code: ErrorCode }) {
  const iconClass = 'h-4 w-4 shrink-0';
  switch (code) {
    case 'PDF_SCANNED':
      return <FileText className={`${iconClass} text-amber-500`} />;
    case 'PDF_EMPTY':
      return <FileText className={`${iconClass} text-orange-500`} />;
    case 'DOCX_EMPTY':
      return <FileText className={`${iconClass} text-orange-500`} />;
    case 'TEXT_EMPTY':
      return <FileText className={`${iconClass} text-gray-500`} />;
    case 'EMBEDDING_FAILED':
      return <AlertCircle className={`${iconClass} text-red-500`} />;
    case 'PROCESSING_TIMEOUT':
      return <AlertCircle className={`${iconClass} text-red-500`} />;
    default:
      return <AlertCircle className={`${iconClass} text-destructive`} />;
  }
}

/** Mensaje corto para el badge en la lista */
function getBadgeLabel(code: ErrorCode): string {
  switch (code) {
    case 'PDF_SCANNED':
      return 'PDF escaneado';
    case 'PDF_EMPTY':
      return 'PDF vacío';
    case 'DOCX_EMPTY':
      return 'Word vacío';
    case 'TEXT_EMPTY':
      return 'Archivo vacío';
    case 'EMBEDDING_FAILED':
      return 'Embedding falló';
    case 'PROCESSING_TIMEOUT':
      return 'Tiempo agotado';
    default:
      return 'Error';
  }
}

/** Sugerencias accionables por código de error */
function getActionableSuggestions(code: ErrorCode): { label: string; hint: string }[] {
  switch (code) {
    case 'PDF_SCANNED':
      return [
        { label: '📷 Usar OCR', hint: 'Convierte tu PDF a texto usando Adobe Acrobat, onlineOCR.net o similar' },
        { label: '📄 Extraer manualmente', hint: 'Copia el texto del PDF y guárdalo como archivo .txt o .md' },
        { label: '🔄 Reenviar versión digital', hint: 'Si el documento ya existe en formato digital, sube esa versión en lugar del escaneo' },
      ];
    case 'PDF_EMPTY':
      return [
        { label: '🔍 Verificar contenido', hint: 'Abre el PDF y confirma que tiene texto seleccionable, no solo imágenes' },
        { label: '📷 Aplicar OCR', hint: 'Usa una herramienta OCR para convertir las imágenes del PDF en texto' },
        { label: '📝 Usar otro formato', hint: 'Convierte el contenido a .txt o .md y súbelo directamente' },
      ];
    case 'DOCX_EMPTY':
      return [
        { label: '📄 Verificar documento', hint: 'Abre el Word y confirma que contiene texto visible' },
        { label: '💾 Exportar a TXT', hint: 'Guarda el documento como .txt y súbelo a KnowledgeDock' },
      ];
    case 'TEXT_EMPTY':
      return [
        { label: '✏️ Agregar contenido', hint: 'Abre el archivo .txt o .md y escribe o pega el contenido deseado' },
        { label: '📋 Copiar desde otra fuente', hint: 'Copia texto de otra aplicación y pégalo en un archivo de texto' },
      ];
    case 'EMBEDDING_FAILED':
      return [
        { label: '✂️ Dividir documento', hint: 'Partes el documento en archivos más pequeños (< 10 MB cada uno)' },
        { label: '🔄 Reintentar', hint: 'El servicio puede estar ocupado; intenta subirlo de nuevo en unos minutos' },
      ];
    case 'PROCESSING_TIMEOUT':
      return [
        { label: '✂️ Reducir tamaño', hint: 'Divide el documento en partes más pequeñas para procesar por separado' },
        { label: '🔄 Reintentar más tarde', hint: 'Intenta la subida dentro de unos minutos cuando haya menos carga' },
      ];
    default:
      return [
        { label: '🔄 Reintentar', hint: 'Sube el archivo nuevamente. Si el problema persiste, contacta soporte.' },
      ];
  }
}

export default function DocumentErrorHint({ errorCode, errorMessage }: DocumentErrorHintProps) {
  const [expanded, setExpanded] = useState(false);

  if (!errorCode || !errorMessage) return null;

  const suggestions = getActionableSuggestions(errorCode);
  const badgeLabel = getBadgeLabel(errorCode);

  return (
    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/80 dark:border-amber-900/40 dark:bg-amber-950/20">
      {/* Header: badge + botón expandir */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-amber-100/60 dark:hover:bg-amber-900/30 rounded-t-lg"
        aria-expanded={expanded}
        aria-controls={`error-detail-${errorCode}`}
      >
        <ErrorIcon code={errorCode} />
        <span className="flex-1 truncate text-xs font-medium text-amber-800 dark:text-amber-200">
          {badgeLabel}
        </span>
        <span className="text-xs text-amber-600 dark:text-amber-400 truncate max-w-[60%]">
          {errorMessage}
        </span>
        {expanded ? (
          <X className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        ) : (
          <Lightbulb className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        )}
      </button>

      {/* Cuerpo expandible con sugerencias */}
      {expanded && (
        <div
          id={`error-detail-${errorCode}`}
          className="border-t border-amber-200 dark:border-amber-900/40 px-3 py-3 space-y-2"
        >
          <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
            {errorMessage}
          </p>

          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-200 flex items-center gap-1.5">
              <FileUp className="h-3 w-3" />
              ¿Qué puedes hacer?
            </p>
            {suggestions.map((s, i) => (
              <div
                key={i}
                className="rounded-md bg-white/60 dark:bg-black/20 px-2.5 py-2"
              >
                <p className="text-xs font-medium text-foreground">{s.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{s.hint}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
