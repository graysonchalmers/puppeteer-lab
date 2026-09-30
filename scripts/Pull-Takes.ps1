<#
Pulls every take the server has that is not already on this machine.
Takes land as <id>.json (the recording) + <id>.meta.json (server metadata) in -Dest.
The meta is written first and the .json is moved into place last: a present <id>.json means that take is complete.
Windows PowerShell 5.1 compatible.
The admin token comes from the MOCAP_ADMIN_TOKEN environment variable (or -Token); never paste it into a command.
#>
param(
  [string]$Base = 'https://mocap.graysonchalmers.com',
  [string]$Dest = 'C:\Projects-local\Tool-PuppeteerLab\data\takes',
  [string]$Token = $env:MOCAP_ADMIN_TOKEN
)
$ErrorActionPreference = 'Stop'
if (-not $Token) { throw 'Set the MOCAP_ADMIN_TOKEN environment variable (or pass -Token) first.' }

# Absolute path: [System.IO.File] resolves relative paths against the process directory, not PowerShell's location.
$Dest = (New-Item -ItemType Directory -Force -Path $Dest).FullName
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$headers = @{ Authorization = "Bearer $Token" }
$list = Invoke-RestMethod -Uri "$Base/api/admin/takes" -Headers $headers

$new = 0
foreach ($t in $list.takes) {
  $json = Join-Path $Dest "$($t.id).json"
  if (Test-Path $json) { continue }
  $part = "$json.part"
  Invoke-WebRequest -UseBasicParsing -Uri "$Base/api/admin/takes/$($t.id)/file" -Headers $headers -OutFile $part
  # Set-Content -Encoding UTF8 writes a BOM on 5.1, which JSON.parse rejects.
  [System.IO.File]::WriteAllText((Join-Path $Dest "$($t.id).meta.json"), ($t | ConvertTo-Json -Depth 5), $utf8NoBom)
  Move-Item -Force $part $json
  $new++
}
Write-Host "Pulled $new new take(s); $($list.count) on the server, $($list.storedBytes) bytes stored."
