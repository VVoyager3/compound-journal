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
$env:JAVA_HOME = 'D:\dev\jdk21\jdk-21.0.12+8'
if (-not (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin\java.exe'))) {
    throw "Android 构建需要 JDK 21；未找到：$env:JAVA_HOME"
}
$env:ANDROID_HOME = $androidSdk
$env:ANDROID_SDK_ROOT = $androidSdk
$env:ANDROID_USER_HOME = Join-Path $workspace '.android-user'
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
1. 完成首次记录、目标拆解、MAIN 反馈和经验撤销。
2. 添加小/中/大今日任务组件，检查任务数量、隐私、逐项完成和任务定位。
3. 断网重启后完成本地记录与任务，再联网验证 MiniMax。
4. 检查 200% 字体、深色模式、减少动画、后台回收和系统分享备份。
5. 备份项目内 .android-user/debug.keystore；丢失后将无法覆盖升级已安装版本。
'@
} finally {
    if ($Emulator) {
        & $adb -s $serial shell svc wifi enable | Out-Null
        & $adb -s $serial shell svc data enable | Out-Null
    }
    Pop-Location
}
