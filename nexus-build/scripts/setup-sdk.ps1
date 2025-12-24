# ============================================================================
# Synthesics2 - Android SDK Setup Script
# Downloads and configures Android SDK Command-line Tools
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
Write-Host "   Synthesics2 - Android SDK Setup" -ForegroundColor Cyan
Write-Host ""

# Default paths
$AndroidSdkPath = "$env:USERPROFILE\AppData\Local\Android\Sdk"
$CmdlineToolsUrl = "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"
$TempZip = "$env:TEMP\android-cmdline-tools.zip"

# ============================================================================
# Check if SDK already exists
# ============================================================================

Write-Header "Verification du SDK existant"

if (Test-Path "$AndroidSdkPath\cmdline-tools") {
    Write-Info "Android SDK deja installe dans: $AndroidSdkPath"
    Write-Host ""
    $continue = Read-Host "Voulez-vous reinstaller? (o/N)"
    if ($continue -ne "o" -and $continue -ne "O") {
        Write-Info "Installation annulee"
        exit 0
    }
}

# ============================================================================
# Create SDK directory
# ============================================================================

Write-Header "Creation du repertoire SDK"

if (!(Test-Path $AndroidSdkPath)) {
    New-Item -ItemType Directory -Path $AndroidSdkPath -Force | Out-Null
    Write-Success "Repertoire cree: $AndroidSdkPath"
} else {
    Write-Info "Repertoire existe: $AndroidSdkPath"
}

# ============================================================================
# Download Command-line Tools
# ============================================================================

Write-Header "Telechargement des outils en ligne de commande"

Write-Step "Telechargement depuis Google..."
Write-Info "URL: $CmdlineToolsUrl"

try {
    # Use TLS 1.2
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    $webClient = New-Object System.Net.WebClient
    $webClient.DownloadFile($CmdlineToolsUrl, $TempZip)

    Write-Success "Telechargement termine"
} catch {
    Write-Error "Echec du telechargement: $_"
    exit 1
}

# ============================================================================
# Extract Tools
# ============================================================================

Write-Header "Extraction des outils"

Write-Step "Extraction de l'archive..."

try {
    # Remove existing cmdline-tools if present
    $cmdlineToolsPath = "$AndroidSdkPath\cmdline-tools"
    if (Test-Path $cmdlineToolsPath) {
        Remove-Item -Path $cmdlineToolsPath -Recurse -Force
    }

    # Extract to temp directory first
    $tempExtract = "$env:TEMP\android-cmdline-extract"
    if (Test-Path $tempExtract) {
        Remove-Item -Path $tempExtract -Recurse -Force
    }

    Expand-Archive -Path $TempZip -DestinationPath $tempExtract -Force

    # Create proper directory structure
    New-Item -ItemType Directory -Path "$cmdlineToolsPath\latest" -Force | Out-Null

    # Move contents to latest folder
    Move-Item -Path "$tempExtract\cmdline-tools\*" -Destination "$cmdlineToolsPath\latest" -Force

    # Cleanup
    Remove-Item -Path $tempExtract -Recurse -Force
    Remove-Item -Path $TempZip -Force

    Write-Success "Extraction terminee"
} catch {
    Write-Error "Echec de l'extraction: $_"
    exit 1
}

# ============================================================================
# Install SDK Components
# ============================================================================

Write-Header "Installation des composants SDK"

$sdkmanager = "$AndroidSdkPath\cmdline-tools\latest\bin\sdkmanager.bat"

if (!(Test-Path $sdkmanager)) {
    Write-Error "sdkmanager non trouve"
    exit 1
}

# Accept licenses
Write-Step "Acceptation des licences..."
echo "y" | & $sdkmanager --licenses 2>&1 | Out-Null
Write-Success "Licences acceptees"

# Install platform-tools
Write-Step "Installation de platform-tools..."
& $sdkmanager "platform-tools" 2>&1 | Out-Null
Write-Success "platform-tools installe"

# Install build-tools
Write-Step "Installation de build-tools;34.0.0..."
& $sdkmanager "build-tools;34.0.0" 2>&1 | Out-Null
Write-Success "build-tools installe"

# Install platform
Write-Step "Installation de platforms;android-34..."
& $sdkmanager "platforms;android-34" 2>&1 | Out-Null
Write-Success "Android platform 34 installe"

# ============================================================================
# Set Environment Variables
# ============================================================================

Write-Header "Configuration des variables d'environnement"

Write-Step "Configuration de ANDROID_HOME..."

# Set for current session
$env:ANDROID_HOME = $AndroidSdkPath
$env:ANDROID_SDK_ROOT = $AndroidSdkPath

# Set permanently for user
[Environment]::SetEnvironmentVariable("ANDROID_HOME", $AndroidSdkPath, "User")
[Environment]::SetEnvironmentVariable("ANDROID_SDK_ROOT", $AndroidSdkPath, "User")

Write-Success "ANDROID_HOME = $AndroidSdkPath"

# Add to PATH
Write-Step "Ajout au PATH..."

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$pathsToAdd = @(
    "$AndroidSdkPath\platform-tools",
    "$AndroidSdkPath\cmdline-tools\latest\bin"
)

$pathModified = $false
foreach ($pathToAdd in $pathsToAdd) {
    if ($userPath -notlike "*$pathToAdd*") {
        $userPath = "$userPath;$pathToAdd"
        $pathModified = $true
        Write-Info "Ajoute: $pathToAdd"
    }
}

if ($pathModified) {
    [Environment]::SetEnvironmentVariable("Path", $userPath, "User")
    Write-Success "PATH mis a jour"
} else {
    Write-Info "PATH deja configure"
}

# ============================================================================
# Verify Installation
# ============================================================================

Write-Header "Verification de l'installation"

# Refresh PATH for current session
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")

Write-Step "Verification d'adb..."
try {
    $adbPath = "$AndroidSdkPath\platform-tools\adb.exe"
    if (Test-Path $adbPath) {
        $adbVersion = & $adbPath version 2>&1 | Select-Object -First 1
        Write-Success "adb: $adbVersion"
    } else {
        Write-Error "adb non trouve"
    }
} catch {
    Write-Error "Erreur verification adb: $_"
}

Write-Step "Verification de sdkmanager..."
$sdkVersion = & $sdkmanager --version 2>&1
Write-Success "sdkmanager: $sdkVersion"

# ============================================================================
# Summary
# ============================================================================

Write-Header "Installation terminee!"

Write-Host ""
Write-Host "  Android SDK installe dans:" -ForegroundColor White
Write-Host "    $AndroidSdkPath" -ForegroundColor Green
Write-Host ""
Write-Host "  Variables d'environnement configurees:" -ForegroundColor White
Write-Host "    ANDROID_HOME = $AndroidSdkPath" -ForegroundColor Cyan
Write-Host "    ANDROID_SDK_ROOT = $AndroidSdkPath" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Composants installes:" -ForegroundColor White
Write-Host "    - platform-tools (adb)" -ForegroundColor Gray
Write-Host "    - build-tools;34.0.0" -ForegroundColor Gray
Write-Host "    - platforms;android-34" -ForegroundColor Gray
Write-Host ""
Write-Host "  [!] IMPORTANT: Redemarrez votre terminal ou VS Code" -ForegroundColor Yellow
Write-Host "      pour que les changements de PATH prennent effet." -ForegroundColor Yellow
Write-Host ""

# Optional: Install additional components
Write-Host ""
$installMore = Read-Host "Installer des composants supplementaires? (o/N)"
if ($installMore -eq "o" -or $installMore -eq "O") {
    Write-Host ""
    Write-Host "Composants recommandes:" -ForegroundColor Yellow
    Write-Host "  1. NDK (pour les builds natifs)" -ForegroundColor Gray
    Write-Host "  2. CMake (pour C++)" -ForegroundColor Gray
    Write-Host "  3. Emulator" -ForegroundColor Gray
    Write-Host ""

    $choice = Read-Host "Entrez les numeros separes par des virgules (ex: 1,2)"

    if ($choice -match "1") {
        Write-Step "Installation du NDK..."
        & $sdkmanager "ndk;26.1.10909125" 2>&1 | Out-Null
        Write-Success "NDK installe"
    }

    if ($choice -match "2") {
        Write-Step "Installation de CMake..."
        & $sdkmanager "cmake;3.22.1" 2>&1 | Out-Null
        Write-Success "CMake installe"
    }

    if ($choice -match "3") {
        Write-Step "Installation de l'emulateur..."
        & $sdkmanager "emulator" 2>&1 | Out-Null
        & $sdkmanager "system-images;android-34;google_apis;x86_64" 2>&1 | Out-Null
        Write-Success "Emulator installe"
    }
}

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""
