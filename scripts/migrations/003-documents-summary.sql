-- 003-documents-summary.sql
-- Añade columna summary a la tabla documents
-- para almacenar el resumen generado.

BEGIN;

ALTER TABLE documents ADD COLUMN IF NOT EXISTS summary text;

COMMIT;

-- Comentario: La columna summary almacena el resumen del documento, o NULL si no se pudo generar.
