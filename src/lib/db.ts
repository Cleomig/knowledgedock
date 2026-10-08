import { Pool } from "pg";
import type { PoolClient } from "pg";

/**
 * Pool de conexión a PostgreSQL con pgvector.
 * Se inicializa perezosamente desde DATABASE_URL en el entorno.
 */
let _pool: Pool | null = null;

export function getPool(): Pool {
  if (!_pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL no está configurada. Crea un archivo .env con la URL de Neon Postgres."
      );
    }
    _pool = new Pool({ connectionString });
  }
  return _pool;
}

/**
 * Ejecuta una query y retorna los resultados como array de objetos.
 * Cierra el cliente automáticamente al terminar.
 */
export async function query<T = unknown>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const pool = getPool();
  const client: PoolClient = await pool.connect();
  try {
    const res = await client.query(sql, params ?? []);
    return res.rows as T[];
  } finally {
    client.release();
  }
}

/**
 * Ejecuta una query de escritura (INSERT/UPDATE/DELETE) y retorna el número
 * de filas afectadas.
 */
export async function execute(
  sql: string,
  params?: unknown[]
): Promise<number> {
  const pool = getPool();
  const client: PoolClient = await pool.connect();
  try {
    const res = await client.query(sql, params ?? []);
    return res.rowCount ?? 0;
  } finally {
    client.release();
  }
}

/**
 * Calcula la similitud coseno entre dos vectores.
 * Usado para post-filtrar resultados y aplicar umbral de confianza.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vectores de diferente longitud");
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Cierra el pool de conexiones. Útil en tests o shutdown graceful.
 */
export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
