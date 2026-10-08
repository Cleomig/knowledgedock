-- 004-documents-error-code.sql
-- Añade error_code para codificar el tipo de fallo de procesamiento.
-- Valores posibles: PDF_SCANNED, PDF_EMPTY, DOCX_EMPTY, TEXT_EMPTY,
--                   EMBEDDING_FAILED, PROCESSING_TIMEOUT

BEGIN;

ALTER TABLE documents ADD COLUMN IF NOT EXISTS error_code text;

-- Migrar errores existentes que contengan "no contiene texto" a PDF_SCANNED
-- cuando sea un PDF y no tenga texto extraíble
UPDATE documents
SET error_code = 'PDF_SCANNED'
WHERE status = 'failed'
  AND mime_type = 'application/pdf'
  AND (error LIKE '%no contiene texto%' OR error LIKE '%texto extraíble%')
  AND error_code IS NULL;

COMMIT;
