# ============================================================================
# Synthesics2 - Installation Script
# Self-Hosted Mobile Build System for Windows
# ============================================================================

$ErrorActionPreference = "Stop"

# Colors for output
function Write-Header {
    param([string]$Message)
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host "  $Message" -ForegroundColor Cyan
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Step {
    param([string]$Message)
    Write-Host "[*] $Message" -ForegroundColor Yellow
}

function Write-Success {
    param([string]$Message)
    Write-Host "[+] $Message" -ForegroundColor Green
}

function Write-Error {
    param([string]$Message)
    Write-Host "[-] $Message" -ForegroundColor Red
}

function Write-Info {
    param([string]$Message)
    Write-Host "    $Message" -ForegroundColor Gray
}

# Banner
Write-Host ""
Write-Host "   ███████╗██╗   ██╗███╗   ██╗████████╗██╗  ██╗███████╗██████╗ " -ForegroundColor Cyan
Write-Host "   ██╔════╝╚██╗ ██╔╝████╗  ██║╚══██╔══╝██║  ██║██╔════╝╚════██╗" -ForegroundColor Cyan
Write-Host "   ███████╗ ╚████╔╝ ██╔██╗ ██║   ██║   ███████║█████╗   █████╔╝" -ForegroundColor Cyan
Write-Host "   ╚════██║  ╚██╔╝  ██║╚██╗██║   ██║   ██╔══██║██╔══╝  ██╔═══╝ " -ForegroundColor Cyan
Write-Host "   ███████║   ██║   ██║ ╚████║   ██║   ██║  ██║███████╗███████╗" -ForegroundColor Cyan
Write-Host "   ╚══════╝   ╚═╝   ╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚══════╝" -ForegroundColor Cyan
Write-Host ""
Write-Host "   Self-Hosted Mobile Build System - Installation" -ForegroundColor Gray
Write-Host ""

# Get script directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir

# ============================================================================
# Check Prerequisites
# ============================================================================

Write-Header "Verification des prerequis"

# Check Node.js
Write-Step "Verification de Node.js..."
try {
    $nodeVersion = node --version 2>&1
    if ($nodeVersion -match "v(\d+)\.") {
        $majorVersion = [int]$Matches[1]
        if ($majorVersion -ge 18) {
            Write-Success "Node.js $nodeVersion detecte"
        } else {
            Write-Error "Node.js $nodeVersion detecte mais version 18+ requise"
            exit 1
        }
    }
} catch {
    Write-Error "Node.js non trouve. Installez Node.js 18+ depuis https://nodejs.org"
    exit 1
}

# Check npm
Write-Step "Verification de npm..."
try {
    $npmVersion = npm --version 2>&1
    Write-Success "npm $npmVersion detecte"
} catch {
    Write-Error "npm non trouve"
    exit 1
}

# Check Git
Write-Step "Verification de Git..."
try {
    $gitVersion = git --version 2>&1
    Write-Success "$gitVersion detecte"
} catch {
    Write-Error "Git non trouve. Installez Git depuis https://git-scm.com"
    exit 1
}

# Check Java
Write-Step "Verification de Java..."
try {
    $javaVersion = java -version 2>&1 | Select-String "version"
    if ($javaVersion) {
        Write-Success "Java detecte: $javaVersion"
    } else {
        Write-Error "Java non trouve"
        Write-Info "Installez JDK 17 depuis https://adoptium.net"
        exit 1
    }
} catch {
    Write-Error "Java non trouve. Installez JDK 17 depuis https://adoptium.net"
    exit 1
}

# Check JAVA_HOME
Write-Step "Verification de JAVA_HOME..."
if ($env:JAVA_HOME) {
    Write-Success "JAVA_HOME defini: $env:JAVA_HOME"
} else {
    Write-Error "JAVA_HOME non defini"
    Write-Info "Definissez la variable d'environnement JAVA_HOME"
    Write-Info "Exemple: C:\Program Files\Java\jdk-17"
}

# Check Android SDK
Write-Step "Verification du Android SDK..."
$androidSdkPath = "$env:USERPROFILE\AppData\Local\Android\Sdk"
if (Test-Path $androidSdkPath) {
    Write-Success "Android SDK trouve: $androidSdkPath"
} else {
    Write-Error "Android SDK non trouve dans $androidSdkPath"
    Write-Info "Installez Android Studio et le SDK depuis https://developer.android.com/studio"
    Write-Info "Ou executez: .\scripts\setup-sdk.ps1"
}

# Check ANDROID_HOME
Write-Step "Verification de ANDROID_HOME..."
if ($env:ANDROID_HOME) {
    Write-Success "ANDROID_HOME defini: $env:ANDROID_HOME"
} else {
    Write-Error "ANDROID_HOME non defini"
    Write-Info "Definissez la variable d'environnement ANDROID_HOME"
}

# ============================================================================
# Create Directories
# ============================================================================

Write-Header "Creation des repertoires"

$directories = @(
    "$RootDir\storage\builds",
    "$RootDir\storage\apks",
    "$RootDir\storage\logs",
    "$RootDir\storage\repos"
)

foreach ($dir in $directories) {
    if (!(Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        Write-Success "Cree: $dir"
    } else {
        Write-Info "Existe deja: $dir"
    }
}

# ============================================================================
# Configure config.json
# ============================================================================

Write-Header "Configuration"

$configPath = "$RootDir\config.json"
if (Test-Path $configPath) {
    Write-Info "config.json existe deja"

    # Update paths in config
    $config = Get-Content $configPath | ConvertFrom-Json

    # Update with actual paths
    $config.paths.androidSdk = $env:ANDROID_HOME -replace "\\", "\\"
    if ($env:JAVA_HOME) {
        $config.paths.javaHome = $env:JAVA_HOME -replace "\\", "\\"
    }

    $config | ConvertTo-Json -Depth 10 | Set-Content $configPath -Encoding UTF8
    Write-Success "Chemins mis a jour dans config.json"
} else {
    Write-Info "Utilisez le fichier config.json par defaut"
}

# ============================================================================
# Summary
# ============================================================================

Write-Header "Installation terminee!"

Write-Host ""
Write-Host "  Pour demarrer Synthesics2:" -ForegroundColor White
Write-Host ""
Write-Host "    cd $RootDir\api" -ForegroundColor Cyan
Write-Host "    node server.js" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Ou avec npm:" -ForegroundColor White
Write-Host ""
Write-Host "    cd $RootDir\api" -ForegroundColor Cyan
Write-Host "    npm start" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Dashboard: http://localhost:3001" -ForegroundColor Green
Write-Host ""

# Check for missing requirements
$hasWarnings = $false

if (!$env:ANDROID_HOME) {
    Write-Host ""
    Write-Host "  [!] ATTENTION: ANDROID_HOME non defini" -ForegroundColor Yellow
    $hasWarnings = $true
}

if (!$env:JAVA_HOME) {
    Write-Host "  [!] ATTENTION: JAVA_HOME non defini" -ForegroundColor Yellow
    $hasWarnings = $true
}

if ($hasWarnings) {
    Write-Host ""
    Write-Host "  Definissez les variables d'environnement manquantes pour" -ForegroundColor Yellow
    Write-Host "  que les builds fonctionnent correctement." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""
