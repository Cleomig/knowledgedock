import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import DocumentList from '@/components/DocumentList';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mountedRoots: Root[] = [];

afterEach(() => {
  act(() => {
    mountedRoots.splice(0).forEach((root) => root.unmount());
  });
  document.body.innerHTML = '';
});

function renderDocumentList(documents: Array<{ id: string; title: string; createdAt: string; status?: 'processing' | 'ready' | 'failed' | string; error?: string | null; errorCode?: string | null; summary?: string | null }>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push(root);

  act(() => {
    root.render(<DocumentList documents={documents} />);
  });

  return container;
}

describe('DocumentList', () => {
  it('muestra el resumen de un documento listo y el error de uno fallido', () => {
    const summary =
      'Este es un resumen muy largo de un documento listo para mostrar en la lista con truncado en dos líneas.';

    const container = renderDocumentList([
      {
        id: 'doc-ready',
        title: 'Documento listo',
        createdAt: '2024-01-01',
        status: 'ready',
        summary,
      },
      {
        id: 'doc-failed',
        title: 'Documento fallido',
        createdAt: '2024-01-02',
        status: 'failed',
        error: 'No se pudo procesar el archivo.',
      },
    ]);

    expect(container.textContent).toContain('Este es un resumen muy largo');
    expect(container.textContent).toContain('Error');
    expect(container.querySelector('.bg-amber-100')).not.toBeNull();
  });
});
