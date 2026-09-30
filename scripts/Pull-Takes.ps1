<#
Pulls every take the server has that is not already on this machine.
Takes land as <id>.json (the recording) + <id>.meta.json (server metadata) in -Dest.
The admin token comes from the MOCAP_ADMIN_TOKEN environment variable (or -Token); never paste it into a command.
#>
param(
  [string]$Base = 'https://mocap.graysonchalmers.com',
  [string]$Dest = 'C:\Projects-local\Tool-PuppeteerLab\data\takes',
  [string]$Token = $env:MOCAP_ADMIN_TOKEN
)
$ErrorActionPreference = 'Stop'
if (-not $Token) { throw 'Set the MOCAP_ADMIN_TOKEN environment variable (or pass -Token) first.' }

New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$headers = @{ Authorization = "Bearer $Token" }
$list = Invoke-RestMethod -Uri "$Base/api/admin/takes" -Headers $headers

$new = 0
foreach ($t in $list.takes) {
  $json = Join-Path $Dest "$($t.id).json"
  if (Test-Path $json) { continue }
  $part = "$json.part"
  Invoke-WebRequest -Uri "$Base/api/admin/takes/$($t.id)/file" -Headers $headers -OutFile $part
  Move-Item -Force $part $json
  ($t | ConvertTo-Json -Depth 5) | Set-Content -Encoding UTF8 (Join-Path $Dest "$($t.id).meta.json")
  $new++
}
Write-Host "Pulled $new new take(s); $($list.count) on the server, $($list.storedBytes) bytes stored."
