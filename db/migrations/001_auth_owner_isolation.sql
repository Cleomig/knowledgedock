-- Opción A: los documentos antiguos de anonymous no pertenecen a una cuenta
-- verificable; eliminarlos también elimina sus chunks por ON DELETE CASCADE.
DELETE FROM documents WHERE owner_id = 'anonymous';

-- Los originales no se guardan en R2; storage_key ya no es necesario.
ALTER TABLE documents ALTER COLUMN storage_key DROP NOT NULL;
