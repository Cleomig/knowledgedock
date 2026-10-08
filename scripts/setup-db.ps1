# KnowledgeDock — Scripts de instalación local con Docker
#
# Uso:
#   .\scripts\setup-db.ps1
#
# Requisitos previos:
#   - Docker Desktop (o compatidor) corriendo
#   - docker-compose v2 (integrado en `docker` moderno)
#   - psql disponible en PATH (incluido en pgvector:pg16, pero el script lo
#     llama desde dentro del contenedor)

param(
    [switch]$Force,
    [switch]$Help
)

$ErrorActionPreference = "Stop"
$PsDefaultParameterValues["*:Encoding"] = "utf8"

# ─── Colores ──────────────────────────────────────────────────────────────────
function Write-Step([string]$msg) { Write-Host "`n>>> $msg" -ForegroundColor Cyan }
function Write-Ok  ([string]$msg) { Write-Host "    ✔ $msg" -ForegroundColor Green }
function Write-Err ([string]$msg) { Write-Host "    ✘ $msg" -ForegroundColor Red   }

if ($Help) {
    Write-Host @"

Conecta KnowledgeDock a una base PostgreSQL local con pgvector.

Uso:
    .\scripts\setup-db.ps1                 # flujo completo
    .\scripts\setup-db.ps1 -Force          # destruye y recrea el volumen existente
    .\scripts\setup-db.ps1 -Help           # esta ayuda

El script:
  1. Verifica que Docker está disponible
  2. Levanta el contenedor con docker-compose
  3. Espera a que la salud del contenedor sea 'healthy'
  4. Ejecuta db/schema.sql dentro del contenedor
  5. Limpia documentos anónimos anteriores mediante la migración de auth
  6. Verifica tablas de aplicación, Better Auth y el índice HNSW

Si DATABASE_URL ya apunta a este contenedor en .env.local, la app puede
conectar inmediatamente después de ejecutar este script.

"@
    exit 0
}

# ─── 1. Verificar Docker ──────────────────────────────────────────────────────
Write-Step "Verificando Docker"

try {
    $dockerVersion = docker --version
    Write-Ok "Docker detectado: $dockerVersion"
} catch {
    Write-Err "Docker no está disponible en PATH."
    Write-Host "    Instala Docker Desktop desde https://www.docker.com/products/docker-desktop/" -ForegroundColor Yellow
    exit 1
}

try {
    $composeOk = docker compose version 2>&1
    if (-not $composeOk) {
        throw "docker compose no responde"
    }
    Write-Ok "docker compose operativo"
} catch {
    Write-Err "docker compose no disponible."
    Write-Host "    Asegúrate de tener Docker Desktop actualizado." -ForegroundColor Yellow
    exit 1
}

# ─── 2. Levantar el contenedor ────────────────────────────────────────────────
Write-Step "Levantando contenedor PostgreSQL + pgvector"

$composeArgs = @("up", "-d", "--remove-orphans")
if ($Force) {
    $composeArgs += @("--renew-anon-volumes")
}

$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$composeOutput = docker compose @composeArgs 2>&1
$composeExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorActionPreference
$composeOutput | ForEach-Object { Write-Host $_ }
if ($composeExitCode -ne 0) {
    Write-Err "docker compose terminó con código $composeExitCode."
    exit $composeExitCode
}

# Verificar que el contenedor existe
$container = docker ps --filter "name=knowledgedock_postgres" --format "{{.Status}}"
if (-not $container) {
    Write-Err "El contenedor no está corriendo."
    exit 1
}
Write-Ok "Contenedor levanto: $container"

# ─── 3. Esperar healthy ───────────────────────────────────────────────────────
Write-Step "Esperando que PostgreSQL esté healthy"

$maxWait = 30   # segundos
$elapsed  = 0
while ($elapsed -lt $maxWait) {
    $health = docker inspect --format='{{.State.Health.Status}}' knowledgedock_postgres 2>$null
    if ($health -eq "healthy") {
        Write-Ok "PostgreSQL healthy después de ${elapsed}s"
        break
    }
    Start-Sleep -Seconds 2
    $elapsed += 2
    Write-Host "    Esperando... (${elapsed}s / ${maxWait}s)" -NoNewline
    # PS 5.1 no tiene el operador ?? ; se resuelve con un if explícito.
    $shown = if ($health) { $health } else { 'starting' }
    Write-Host " $shown" -ForegroundColor DarkGray
}

if ($health -ne "healthy") {
    Write-Err "Timeout esperando healthy ($maxWait s)."
    Write-Host "    Logs:" -ForegroundColor Yellow
    docker logs knowledgedock_postgres --tail 30
    exit 1
}

# ─── 4. Ejecutar schema.sql ───────────────────────────────────────────────────
Write-Step "Aplicando db/schema.sql"

# PS 5.1: Join-Path admite solo -Path y -ChildPath; se anida en vez de pasar
# varios argumentos posicionales (eso es de PowerShell 6+).
$scriptPath = Join-Path (Join-Path $PSScriptRoot "..") "db"
$scriptPath = Join-Path $scriptPath "schema.sql"
if (-not (Test-Path $scriptPath)) {
    Write-Err "No se encontró db/schema.sql en $scriptPath"
    exit 1
}

# PS 5.1: no soporta el operador de redirección < ; se pasa por tubería.
$schemaSql = Get-Content -LiteralPath $scriptPath -Raw
$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$schemaOutput = $schemaSql | docker exec -i knowledgedock_postgres psql `
    -U knowledgedock `
    -d knowledgedock `
    -v ON_ERROR_STOP=1 `
    -f - 2>&1
$schemaExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorActionPreference

if ($schemaExitCode -ne 0) {
    Write-Err "Error aplicando schema.sql:"
    Write-Host $schemaOutput -ForegroundColor Red
    exit 1
}
Write-Ok "schema.sql aplicado sin errores"

# ─── 5. Aplicar migración de aislamiento ──────────────────────────────────────
Write-Step "Aplicando migración de aislamiento por usuario"

$migrationPath = Join-Path (Join-Path (Join-Path $PSScriptRoot "..") "db") "migrations"
$migrationPath = Join-Path $migrationPath "001_auth_owner_isolation.sql"
if (-not (Test-Path $migrationPath)) {
    Write-Err "No se encontró la migración $migrationPath"
    exit 1
}

$migrationSql = Get-Content -LiteralPath $migrationPath -Raw
$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$migrationOutput = $migrationSql | docker exec -i knowledgedock_postgres psql `
    -U knowledgedock `
    -d knowledgedock `
    -v ON_ERROR_STOP=1 `
    -f - 2>&1
$migrationExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorActionPreference

if ($migrationExitCode -ne 0) {
    Write-Err "Error aplicando la migración:"
    Write-Host $migrationOutput -ForegroundColor Red
    exit 1
}
Write-Ok "Migración aplicada sin errores"

# ─── 6. Verificar tablas e índice ─────────────────────────────────────────────
Write-Step "Verificando estructura de base de datos"

$verify = docker exec knowledgedock_postgres psql `
    -U knowledgedock `
    -d knowledgedock `
    -tAc @"
SELECT 'documents' as tbl, COUNT(*) as cnt FROM information_schema.tables
  WHERE table_schema='public' AND table_name='documents'
UNION ALL
SELECT 'chunks', COUNT(*) FROM information_schema.tables
  WHERE table_schema='public' AND table_name='chunks'
UNION ALL
SELECT 'hnsw_idx', COUNT(*) FROM pg_indexes
  WHERE tablename='chunks' AND indexname='chunks_embedding_idx'
UNION ALL
SELECT 'auth_user', COUNT(*) FROM information_schema.tables
  WHERE table_schema='public' AND table_name='user'
UNION ALL
SELECT 'auth_session', COUNT(*) FROM information_schema.tables
  WHERE table_schema='public' AND table_name='session'
UNION ALL
SELECT 'auth_account', COUNT(*) FROM information_schema.tables
  WHERE table_schema='public' AND table_name='account'
UNION ALL
SELECT 'auth_verification', COUNT(*) FROM information_schema.tables
  WHERE table_schema='public' AND table_name='verification';
"@ 2>&1

$lines = $verify -split "`n" | Where-Object { $_.Trim() -ne "" }
$found = @{}
foreach ($line in $lines) {
    $parts = $line -split '\|'
    if ($parts.Count -ge 2) {
        $found[$parts[0].Trim()] = $parts[1].Trim()
    }
}

$ok = $true
if ($found['documents'] -eq '1') { Write-Ok "Tabla documents ✓" } else { Write-Err "Tabla documents ✗"; $ok = $false }
if ($found['chunks']   -eq '1') { Write-Ok "Tabla chunks   ✓" } else { Write-Err "Tabla chunks   ✗"; $ok = $false }
if ($found['hnsw_idx'] -eq '1') { Write-Ok "Índice HNSW    ✓" } else { Write-Err "Índice HNSW    ✗"; $ok = $false }
if ($found['auth_user'] -eq '1') { Write-Ok "Tabla auth user ✓" } else { Write-Err "Tabla auth user ✗"; $ok = $false }
if ($found['auth_session'] -eq '1') { Write-Ok "Tabla auth session ✓" } else { Write-Err "Tabla auth session ✗"; $ok = $false }
if ($found['auth_account'] -eq '1') { Write-Ok "Tabla auth account ✓" } else { Write-Err "Tabla auth account ✗"; $ok = $false }
if ($found['auth_verification'] -eq '1') { Write-Ok "Tabla auth verification ✓" } else { Write-Err "Tabla auth verification ✗"; $ok = $false }

if (-not $ok) { exit 1 }

# ─── Fin ──────────────────────────────────────────────────────────────────────
Write-Ok "Base de datos lista."
Write-Host ""
Write-Host "  DATABASE_URL para conectar desde la app:" -ForegroundColor Yellow
Write-Host "  postgresql://knowledgedock:dev_password_2024@localhost:55432/knowledgedock" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Puerto 55432: en esta maquina el 5432 lo ocupa un PostgreSQL 18" -ForegroundColor DarkGray
Write-Host "  nativo y el 5433 otro contenedor (bloom_postgres)." -ForegroundColor DarkGray
Write-Host "  Agrega esa linea a .env.local y ejecuta:" -ForegroundColor Yellow
Write-Host "    npm run dev" -ForegroundColor Green
Write-Host ""
