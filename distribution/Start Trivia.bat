@echo off
cd /d "%~dp0"
if exist ".runtime\node.exe" goto launch
echo Preparing Party Trivia for the first time. This needs an internet connection.
powershell -NoProfile -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; New-Item -ItemType Directory -Force '.runtime' | Out-Null; $base='https://nodejs.org/dist/v22.22.1/'; Invoke-WebRequest ($base+'win-x64/node.exe') -OutFile '.runtime/node.download'; $sums=(Invoke-WebRequest ($base+'SHASUMS256.txt')).Content; $line=($sums -split '\n' | Where-Object { $_ -match '\swin-x64/node.exe\s*$' }); if(-not $line){throw 'Could not verify download'}; $expected=($line.Trim() -split '\s+')[0]; $actual=(Get-FileHash '.runtime/node.download' -Algorithm SHA256).Hash; if($actual -ne $expected){throw 'Download verification failed'}; Move-Item -Force '.runtime/node.download' '.runtime/node.exe'"
if errorlevel 1 goto error
:launch
".runtime\node.exe" launcher.mjs
if errorlevel 1 goto error
goto end
:error
echo Could not start. Send the message above to the person who gave you this app.
:end
pause
