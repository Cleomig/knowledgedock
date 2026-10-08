-- 002-documents-status.sql
-- Añade columnas status y error a la tabla documents
-- para soportar ingesta asíncrona.

BEGIN;

-- Añadir columna status con valor por defecto 'ready' para documentos existentes
ALTER TABLE documents ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ready';

-- Añadir columna error para almacenar mensajes de error cuando status = 'failed'
ALTER TABLE documents ADD COLUMN IF NOT EXISTS error text;

COMMIT;

-- Comentario: Las columnas status y error permiten implementar ingesta asíncrona.
-- Status posibles: 'processing', 'ready', 'failed'
-- Error almacena el mensaje de error cuando status = 'failed' (opcional)