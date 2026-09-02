param(
    [switch]$SkipBuild,
    [switch]$Emulator
)

$ErrorActionPreference = 'Stop'
$packageName = 'com.vvoyager3.qiguang'
$workspace = Split-Path -Parent $PSScriptRoot
$apk = Join-Path $workspace 'android\app\build\outputs\apk\debug\app-debug.apk'
$testApk = Join-Path $workspace 'android\app\build\outputs\apk\androidTest\debug\app-debug-androidTest.apk'
$androidSdk = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } elseif ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { 'D:\dev\android-sdk' }
$adb = Join-Path $androidSdk 'platform-tools\adb.exe'

if (-not (Test-Path -LiteralPath $adb)) {
    $adbCommand = Get-Command adb -ErrorAction SilentlyContinue
    if (-not $adbCommand) { throw '找不到 adb。请设置 ANDROID_SDK_ROOT，或安装 Android platform-tools。' }
    $adb = $adbCommand.Source
    $androidSdk = Split-Path -Parent (Split-Path -Parent $adb)
}

$devices = & $adb devices | Select-Object -Skip 1 | Where-Object { $_ -match '\S' } | ForEach-Object {
    $parts = $_ -split '\s+'
    [pscustomobject]@{ Serial = $parts[0]; State = $parts[1] }
}
$online = @($devices | Where-Object State -eq 'device')
$candidates = if ($Emulator) {
    @($online | Where-Object Serial -like 'emulator-*')
} else {
    @($online | Where-Object Serial -notlike 'emulator-*')
}
$targetLabel = if ($Emulator) { 'Android Studio 模拟器' } else { '已授权 Android 真机' }
if ($candidates.Count -ne 1) { throw "需要且只能连接一台$targetLabel；当前匹配设备数：$($candidates.Count)。" }
$serial = $candidates[0].Serial
$isEmulator = (& $adb -s $serial shell getprop ro.kernel.qemu).Trim()
if ($Emulator -and $isEmulator -ne '1') { throw '指定设备不是 Android 模拟器。' }
if (-not $Emulator -and $isEmulator -eq '1') { throw '本验收只接受真实 Android 设备，不用模拟器代替真机结论。' }

$tempRoot = if ($Emulator) { 'D:\tmp\qiguang-emulator-check' } else { 'D:\tmp\qiguang-device-check' }
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
$env:TEMP = Join-Path $tempRoot 'temp'
$env:TMP = $env:TEMP
$env:GRADLE_USER_HOME = Join-Path $tempRoot 'gradle'
$env:KOTLIN_DAEMON_RUN_FILES_PATH = Join-Path $tempRoot 'kotlin-daemon'
$jdkCandidates = @(@(
    $env:JAVA_HOME
    (Join-Path $env:ProgramFiles 'Android\Android Studio\jbr')
    (Join-Path $env:ProgramFiles 'Eclipse Adoptium')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) })
$portableJdkRoot = Join-Path $env:USERPROFILE '.codex\tools\jdk-21'
if (Test-Path -LiteralPath $portableJdkRoot) {
    $jdkCandidates += @(Get-ChildItem -LiteralPath $portableJdkRoot -Directory -Recurse -Depth 3 -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\java.exe') } |
        Select-Object -ExpandProperty FullName)
}
$pathJava = Get-Command java -ErrorAction SilentlyContinue
if ($pathJava) { $jdkCandidates += Split-Path -Parent (Split-Path -Parent $pathJava.Source) }
$jdkHome = $jdkCandidates | ForEach-Object {
    $candidate = $_
    if (Test-Path -LiteralPath (Join-Path $candidate 'bin\java.exe')) {
        $versionOutput = (& (Join-Path $candidate 'bin\java.exe') -version 2>&1) -join "`n"
        if ($versionOutput -match 'version "(?<major>\d+)' -and [int]$Matches.major -ge 21) { $candidate }
    } elseif (Test-Path -LiteralPath $candidate) {
        Get-ChildItem -LiteralPath $candidate -Directory -Filter 'jdk-21*' -ErrorAction SilentlyContinue | ForEach-Object {
            $nested = $_.FullName
            if (Test-Path -LiteralPath (Join-Path $nested 'bin\java.exe')) { $nested }
        }
    }
} | Select-Object -First 1
if (-not $jdkHome) { throw 'Android 构建需要 JDK 21。请设置 JAVA_HOME，或安装 Android Studio / Temurin 21。' }
$env:JAVA_HOME = $jdkHome
$env:ANDROID_HOME = $androidSdk
$env:ANDROID_SDK_ROOT = $androidSdk
$defaultAndroidUserHome = Join-Path $env:USERPROFILE '.android'
$projectAndroidUserHome = Join-Path $workspace '.android-user'
$env:ANDROID_USER_HOME = if (Test-Path -LiteralPath (Join-Path $defaultAndroidUserHome 'debug.keystore')) {
    $defaultAndroidUserHome
} else {
    $projectAndroidUserHome
}
$env:ANDROID_SERIAL = $serial
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
New-Item -ItemType Directory -Force -Path $env:TEMP, $env:GRADLE_USER_HOME, $env:KOTLIN_DAEMON_RUN_FILES_PATH, $env:ANDROID_USER_HOME | Out-Null

Push-Location $workspace
try {
    if (-not $SkipBuild) {
        npm run android:debug
        if ($LASTEXITCODE -ne 0) { throw 'Android Debug APK 构建失败。' }
    }
    if (-not (Test-Path -LiteralPath $apk)) { throw "找不到 APK：$apk" }

    $installedPackage = & $adb -s $serial shell pm path $packageName 2>$null |
        Where-Object { $_ -like 'package:*' } |
        Select-Object -First 1
    if ($installedPackage) {
        $apksigner = Get-ChildItem -LiteralPath (Join-Path $androidSdk 'build-tools') -Filter 'apksigner.bat' -File -Recurse -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending |
            Select-Object -First 1 -ExpandProperty FullName
        if (-not $apksigner) { throw '无法验证 APK 签名：Android SDK 中缺少 apksigner。' }

        $installedApk = Join-Path $tempRoot 'installed-qiguang.apk'
        & $adb -s $serial pull ($installedPackage -replace '^package:', '') $installedApk | Out-Null
        if ($LASTEXITCODE -ne 0) { throw '无法读取已安装版本，已停止覆盖安装。' }

        $readSigner = {
            param([string]$apkPath)
            $certificateOutput = (& $apksigner verify --print-certs $apkPath 2>&1) -join "`n"
            if ($LASTEXITCODE -ne 0 -or $certificateOutput -notmatch 'Signer #1 certificate SHA-256 digest:\s*(?<digest>[0-9a-fA-F]+)') {
                throw "无法验证 APK 签名：$apkPath"
            }
            $Matches.digest.ToLowerInvariant()
        }
        $installedSigner = & $readSigner $installedApk
        $candidateSigner = & $readSigner $apk
        if ($installedSigner -ne $candidateSigner) {
            throw 'APK 签名与已安装版本不一致，已停止安装；不会卸载应用或清除数据。'
        }
    }

    & $adb -s $serial install -r $apk
    if ($LASTEXITCODE -ne 0) {
        throw '覆盖安装失败。不要直接卸载旧版；先在旧版导出备份，再检查 APK 签名是否一致。'
    }
    & $adb -s $serial shell am force-stop $packageName
    & $adb -s $serial shell am start -W -n "$packageName/.MainActivity"
    if ($LASTEXITCODE -ne 0) { throw '应用启动失败。' }

    Push-Location (Join-Path $workspace 'android')
    try {
        .\gradlew.bat :app:assembleDebugAndroidTest
        if ($LASTEXITCODE -ne 0) { throw "$targetLabel 测试 APK 构建失败。" }
    } finally {
        Pop-Location
    }
    if (-not (Test-Path -LiteralPath $testApk)) { throw "找不到测试 APK：$testApk" }
    & $adb -s $serial install -r $testApk
    if ($LASTEXITCODE -ne 0) { throw "$targetLabel 测试 APK 安装失败。" }
    $instrumentation = (& $adb -s $serial shell am instrument -w 'com.vvoyager3.qiguang.test/androidx.test.runner.AndroidJUnitRunner') -join "`n"
    if ($LASTEXITCODE -ne 0 -or $instrumentation -notmatch 'OK \(\d+ test') {
        Write-Host $instrumentation
        throw "$targetLabel 仪器测试失败。"
    }

    if ($Emulator) {
        & $adb -s $serial shell svc wifi disable
        & $adb -s $serial shell svc data disable
    }

    & $adb -s $serial shell am force-stop $packageName
    & $adb -s $serial shell am start -W -n "$packageName/.MainActivity"
    if ($LASTEXITCODE -ne 0) { throw "$targetLabel 测试后冷启动失败。" }

    $appProcessId = ((& $adb -s $serial shell pidof $packageName) -join '').Trim()
    if (-not $appProcessId) { throw '测试后未发现栖光进程。' }
    $version = & $adb -s $serial shell dumpsys package $packageName | Select-String 'versionName=|versionCode=' | Select-Object -First 2
    Write-Host "`n自动${targetLabel}冒烟通过：$serial · PID $appProcessId"
    $version | ForEach-Object { Write-Host $_.Line.Trim() }
    Write-Host @'

仍需人工观察：
1. 完成首次记录、目标拆解、今日任务反馈和成长值撤销。
2. 添加小/中/大今日任务组件，检查任务数量、隐私、逐项完成和任务定位。
3. 断网重启后完成本地记录与任务，再联网验证 MiniMax。
4. 检查 200% 字体、深色模式、减少动画、后台回收和系统分享备份。
5. 备份当前 Android debug.keystore；丢失后将无法覆盖升级已安装版本。
'@
} finally {
    if ($Emulator) {
        & $adb -s $serial shell svc wifi enable | Out-Null
        & $adb -s $serial shell svc data enable | Out-Null
    }
    Pop-Location
}
