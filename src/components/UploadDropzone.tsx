'use client';

import { useState, DragEvent, ChangeEvent, useCallback } from 'react';
import { UploadCloud, Loader2, CheckCircle2 } from 'lucide-react';

interface UploadDropzoneProps {
  onUploaded?: (doc: { id: string; title: string }) => void;
  onError?: (msg: string) => void;
}

export default function UploadDropzone({ onUploaded, onError }: UploadDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const processFile = useCallback(async (file: File) => {
    const allowed = ['text/plain', 'text/markdown', 'application/pdf', 'text/x-markdown'];
    if (!allowed.includes(file.type) && !file.name.match(/\.(txt|md|pdf)$/i)) {
      const msg = 'Formato no soportado. Usa .txt, .md o .pdf';
      setErrorMsg(msg);
      setStatus('error');
      onError?.(msg);
      return;
    }

    setStatus('uploading');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', file.name);

    try {
      const res = await fetch('/api/documents', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      setStatus('done');
      onUploaded?.({ id: data.id, title: data.title });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al subir';
      setErrorMsg(msg);
      setStatus('error');
      onError?.(msg);
    }
  }, [onUploaded, onError]);

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };
  const handleFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  return (
    <div
      className={`relative rounded-2xl border-2 border-dashed p-6 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        isDragging ? 'border-primary bg-muted' : 'border-border hover:bg-muted/50'
      } ${status === 'done' ? 'border-green-500 bg-green-500/5' : ''} ${status === 'error' ? 'border-destructive bg-destructive/5' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      tabIndex={0}
      role="button"
      aria-label="Subir documento"
    >
      <input
        type="file"
        accept=".txt,.md,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={handleFileInput}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        aria-hidden="true"
      />
      <div className="flex flex-col items-center gap-3">
        {status === 'uploading' && <Loader2 className="h-8 w-8 animate-spin text-primary" />}
        {status === 'done' && <CheckCircle2 className="h-8 w-8 text-green-500" />}
        {status === 'error' && <UploadCloud className="h-8 w-8 text-destructive" />}
        {status === 'idle' && <UploadCloud className="h-8 w-8 text-muted-foreground" />}

        <div>
          <p className="text-sm font-medium text-foreground">
            {status === 'uploading' && 'Indexando...'}
            {status === 'done' && '¡Documento indexado!'}
            {status === 'error' && 'Error'}
            {status === 'idle' && 'Arrastra o selecciona un archivo'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Soporta .txt, .md y .pdf
          </p>
        </div>
        {status === 'error' && errorMsg && (
          <p className="text-xs text-destructive mt-1">{errorMsg}</p>
        )}
      </div>
    </div>
  );
}
