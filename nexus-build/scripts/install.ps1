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

# Check and Configure JAVA_HOME
Write-Step "Verification de JAVA_HOME..."
$javaHome = $null

# Detect Java installation path
$javaPaths = @(
    "$env:ProgramFiles\Eclipse Adoptium",
    "$env:ProgramFiles\Java",
    "$env:ProgramFiles\Microsoft\jdk-*",
    "$env:ProgramFiles\Zulu"
)

foreach ($basePath in $javaPaths) {
    if (Test-Path $basePath) {
        $jdkDirs = Get-ChildItem -Path $basePath -Directory -ErrorAction SilentlyContinue |
                   Where-Object { $_.Name -match "jdk" } |
                   Sort-Object Name -Descending
        if ($jdkDirs) {
            $javaHome = $jdkDirs[0].FullName
            break
        }
    }
}

if ($env:JAVA_HOME -and (Test-Path $env:JAVA_HOME)) {
    Write-Success "JAVA_HOME defini: $env:JAVA_HOME"
} elseif ($javaHome) {
    Write-Info "Java detecte: $javaHome"
    Write-Step "Configuration de JAVA_HOME..."
    [Environment]::SetEnvironmentVariable("JAVA_HOME", $javaHome, "User")
    $env:JAVA_HOME = $javaHome
    Write-Success "JAVA_HOME configure: $javaHome"
} else {
    Write-Error "Java non trouve"
    Write-Info "Installez JDK 17+ depuis https://adoptium.net"
}

# Check and Configure Android SDK
Write-Step "Verification du Android SDK..."
$androidSdkPath = "$env:USERPROFILE\AppData\Local\Android\Sdk"

if (Test-Path $androidSdkPath) {
    Write-Success "Android SDK trouve: $androidSdkPath"

    # Check build-tools version
    $buildToolsDir = "$androidSdkPath\build-tools"
    if (Test-Path $buildToolsDir) {
        $btVersions = Get-ChildItem -Path $buildToolsDir -Directory | Sort-Object Name -Descending
        if ($btVersions) {
            Write-Info "Build Tools: $($btVersions[0].Name)"
        }
    }

    # Check platforms
    $platformsDir = "$androidSdkPath\platforms"
    if (Test-Path $platformsDir) {
        $platforms = Get-ChildItem -Path $platformsDir -Directory | Sort-Object Name -Descending
        if ($platforms) {
            Write-Info "Platform: $($platforms[0].Name)"
        }
    }
} else {
    Write-Error "Android SDK non trouve dans $androidSdkPath"
    Write-Info "Installez Android Studio et le SDK depuis https://developer.android.com/studio"
    Write-Info "Ou executez: .\scripts\setup-sdk.ps1"
}

# Configure ANDROID_HOME and ANDROID_SDK_ROOT
Write-Step "Configuration des variables Android..."

if (Test-Path $androidSdkPath) {
    if (!$env:ANDROID_HOME -or $env:ANDROID_HOME -ne $androidSdkPath) {
        [Environment]::SetEnvironmentVariable("ANDROID_HOME", $androidSdkPath, "User")
        $env:ANDROID_HOME = $androidSdkPath
        Write-Success "ANDROID_HOME configure: $androidSdkPath"
    } else {
        Write-Success "ANDROID_HOME deja defini: $env:ANDROID_HOME"
    }

    if (!$env:ANDROID_SDK_ROOT -or $env:ANDROID_SDK_ROOT -ne $androidSdkPath) {
        [Environment]::SetEnvironmentVariable("ANDROID_SDK_ROOT", $androidSdkPath, "User")
        $env:ANDROID_SDK_ROOT = $androidSdkPath
        Write-Success "ANDROID_SDK_ROOT configure: $androidSdkPath"
    }

    # Add to PATH if not already present
    Write-Step "Configuration du PATH..."
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $pathsToAdd = @(
        "$androidSdkPath\platform-tools",
        "$androidSdkPath\cmdline-tools\latest\bin",
        "$androidSdkPath\emulator"
    )

    $pathModified = $false
    foreach ($pathToAdd in $pathsToAdd) {
        if ((Test-Path $pathToAdd) -and ($userPath -notlike "*$pathToAdd*")) {
            $userPath = "$pathToAdd;$userPath"
            $pathModified = $true
            Write-Info "Ajoute au PATH: $pathToAdd"
        }
    }

    if ($pathModified) {
        [Environment]::SetEnvironmentVariable("Path", $userPath, "User")
        $env:Path = "$userPath;$env:Path"
        Write-Success "PATH mis a jour"
    } else {
        Write-Info "PATH deja configure"
    }
} else {
    Write-Error "Impossible de configurer ANDROID_HOME - SDK non trouve"
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

# Verify final configuration
Write-Host ""
Write-Host "  Configuration finale:" -ForegroundColor White
Write-Host ""

if ($env:JAVA_HOME) {
    Write-Host "    JAVA_HOME:        $env:JAVA_HOME" -ForegroundColor Green
} else {
    Write-Host "    JAVA_HOME:        [NON DEFINI]" -ForegroundColor Red
}

if ($env:ANDROID_HOME) {
    Write-Host "    ANDROID_HOME:     $env:ANDROID_HOME" -ForegroundColor Green
} else {
    Write-Host "    ANDROID_HOME:     [NON DEFINI]" -ForegroundColor Red
}

if ($env:ANDROID_SDK_ROOT) {
    Write-Host "    ANDROID_SDK_ROOT: $env:ANDROID_SDK_ROOT" -ForegroundColor Green
} else {
    Write-Host "    ANDROID_SDK_ROOT: [NON DEFINI]" -ForegroundColor Red
}

Write-Host ""

# Check if restart needed
$restartNeeded = $false
if (!$env:ANDROID_HOME -or !$env:JAVA_HOME) {
    Write-Host "  [!] ATTENTION: Certaines variables ne sont pas definies" -ForegroundColor Yellow
    Write-Host "      Verifiez l'installation des prerequis." -ForegroundColor Yellow
    $restartNeeded = $true
} else {
    Write-Host "  [i] Les variables d'environnement ont ete configurees." -ForegroundColor Cyan
    Write-Host "      Redemarrez votre terminal pour appliquer les changements." -ForegroundColor Cyan
    $restartNeeded = $true
}

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# Offer to test configuration
Write-Host "  Voulez-vous tester la configuration maintenant? (O/N)" -ForegroundColor White
$response = Read-Host "  "
if ($response -eq "O" -or $response -eq "o") {
    Write-Host ""
    Write-Step "Test de la configuration..."

    # Test adb
    try {
        $adbPath = "$androidSdkPath\platform-tools\adb.exe"
        if (Test-Path $adbPath) {
            $adbVersion = & $adbPath version 2>&1 | Select-Object -First 1
            Write-Success "ADB: $adbVersion"
        }
    } catch {
        Write-Error "ADB non accessible"
    }

    # Test java
    try {
        if ($env:JAVA_HOME) {
            $javaExe = "$env:JAVA_HOME\bin\java.exe"
            if (Test-Path $javaExe) {
                $javaVer = & $javaExe -version 2>&1 | Select-Object -First 1
                Write-Success "Java: $javaVer"
            }
        }
    } catch {
        Write-Error "Java non accessible"
    }

    Write-Host ""
}

Write-Host ""
