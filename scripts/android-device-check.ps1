param(
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$packageName = 'com.vvoyager3.qiguang'
$workspace = Split-Path -Parent $PSScriptRoot
$apk = Join-Path $workspace 'android\app\build\outputs\apk\debug\app-debug.apk'
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
if ($online.Count -ne 1) { throw "需要且只能连接一台已授权 Android 真机；当前在线设备数：$($online.Count)。" }
$serial = $online[0].Serial
$isEmulator = (& $adb -s $serial shell getprop ro.kernel.qemu).Trim()
if ($serial -like 'emulator-*' -or $isEmulator -eq '1') { throw '本验收只接受真实 Android 设备，不用模拟器代替真机结论。' }

$tempRoot = 'D:\tmp\qiguang-device-check'
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
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
New-Item -ItemType Directory -Force -Path $env:TEMP, $env:GRADLE_USER_HOME, $env:KOTLIN_DAEMON_RUN_FILES_PATH | Out-Null

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
        .\gradlew.bat connectedDebugAndroidTest
        if ($LASTEXITCODE -ne 0) { throw 'Android 真机仪器测试失败。' }
    } finally {
        Pop-Location
    }

    $appProcessId = (& $adb -s $serial shell pidof $packageName).Trim()
    if (-not $appProcessId) { throw '测试后未发现栖光进程。' }
    $version = & $adb -s $serial shell dumpsys package $packageName | Select-String 'versionName=|versionCode=' | Select-Object -First 2
    Write-Host "`n自动真机冒烟通过：$serial · PID $appProcessId"
    $version | ForEach-Object { Write-Host $_.Line.Trim() }
    Write-Host @'

仍需人工观察：
1. 完成首次记录、目标拆解、MAIN 反馈和经验撤销。
2. 添加小/中/大组件，检查隐私、完成 MAIN、任务定位和开始记录。
3. 断网重启后完成本地记录与任务，再联网验证 MiniMax。
4. 检查 200% 字体、深色模式、减少动画、后台回收和系统分享备份。
'@
} finally {
    Pop-Location
}
