# Invio programmato campagna PEC "offerte".
# Lanciato dal Task Scheduler l'11/09/2026 alle 08:00.
# Accoda le PEC; l'invio SMTP effettivo lo fa il worker (pec.max_per_hour).

$ErrorActionPreference = "Continue"
$proj = "C:\Users\Administrator\domain-reselling-platform"
Set-Location $proj
$log = "$proj\scripts\campaign-out\scheduled-run.log"
"==== $(Get-Date -Format s) : avvio invio programmato ====" | Tee-Object -FilePath $log -Append

# 1) infrastruttura locale (Postgres + Redis)
try {
  docker compose -f docker-compose.local.yml up -d 2>&1 | Tee-Object -FilePath $log -Append
} catch {
  "docker compose non riuscito: $_" | Tee-Object -FilePath $log -Append
}

# 2) worker attivo? altrimenti avvialo
$worker = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match "worker:dev|worker/index" }
if (-not $worker) {
  "worker non attivo: lo avvio" | Tee-Object -FilePath $log -Append
  Start-Process -WindowStyle Hidden -FilePath "npm.cmd" -ArgumentList "run","worker:dev" `
    -WorkingDirectory $proj -RedirectStandardOutput "$proj\scripts\campaign-out\worker.out.log" `
    -RedirectStandardError "$proj\scripts\campaign-out\worker.err.log"
  Start-Sleep -Seconds 20
} else {
  "worker gia attivo (pid $($worker.ProcessId))" | Tee-Object -FilePath $log -Append
}

# 3) accoda la campagna sul CSV approvato
& npx.cmd tsx scripts/campaign-offerte.ts --send scripts/campaign-out/abbinamenti-APPROVED.csv --rate 100 2>&1 |
  Tee-Object -FilePath $log -Append

"==== $(Get-Date -Format s) : fine (le PEC vengono spedite dal worker nell'ora successiva) ====" |
  Tee-Object -FilePath $log -Append
