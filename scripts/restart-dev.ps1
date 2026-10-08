# KnowledgeDock — reinicia el servidor de desarrollo
# PowerShell 5.1 compatible.
$ErrorActionPreference = 'Continue'

$p = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*next*dev*' -or $_.CommandLine -like '*next-server*' }

foreach ($proc in $p) {
    Write-Output ("matando PID " + $proc.ProcessId)
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 3

$log = 'C:\Users\cleom\AppData\Local\Temp\opencode\kd-dev.log'
$err = 'C:\Users\cleom\AppData\Local\Temp\opencode\kd-dev-err.log'
Remove-Item $log, $err -ErrorAction SilentlyContinue

Start-Process -FilePath 'cmd' -ArgumentList '/c', 'npm run dev' `
    -WorkingDirectory 'C:\Users\cleom\knowledgedock' -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $log -RedirectStandardError $err | Out-Null

Start-Sleep -Seconds 20

Write-Output '--- log del servidor ---'
Get-Content $log -Tail 12
