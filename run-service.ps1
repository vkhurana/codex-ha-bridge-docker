$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$LogDir = Join-Path $Root "logs"
if (-not (Test-Path $LogDir)) {
  New-Item -ItemType Directory -Path $LogDir | Out-Null
}

$LogFile = Join-Path $LogDir "bridge.log"

function Write-BridgeLog($Message) {
  $Stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -Path $LogFile -Value "[$Stamp] $Message"
}

try {
  if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
      Copy-Item ".env.example" ".env"
    }
    Write-BridgeLog ".env was not found. Add your MQTT settings to the .env file."
    exit 1
  }

  $Candidates = @()

  $NodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($NodeCommand) {
    $Candidates += $NodeCommand.Source
  }

  $Candidates += @(
    "$env:LOCALAPPDATA\OpenAI\Codex\bin\node.exe",
    "$env:LOCALAPPDATA\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\OpenAI\Codex\bin\node.exe",
    "$env:ProgramFiles\nodejs\node.exe",
    "${env:ProgramFiles(x86)}\nodejs\node.exe"
  )

  $NodePath = $Candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

  if (-not $NodePath) {
    Write-BridgeLog "Node was not found."
    exit 1
  }

  Write-BridgeLog "Starting bridge. Node: $NodePath"
  & $NodePath "src\index.js" >> $LogFile 2>&1
  Write-BridgeLog "Bridge stopped."
} catch {
  Write-BridgeLog "Error: $($_.Exception.Message)"
  exit 1
}
