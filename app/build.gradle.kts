import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.devtools.ksp")
}

val apiBaseUrl = providers.gradleProperty("compoundApiBaseUrl")
    .orElse("http://127.0.0.1:4173")
val releaseStoreFile = providers.environmentVariable("RELEASE_STORE_FILE").orNull

gradle.taskGraph.whenReady {
    val releaseRequested = allTasks.any { it.project == project && it.name.contains("Release", ignoreCase = true) }
    if (releaseRequested) {
        require(providers.gradleProperty("compoundApiBaseUrl").isPresent && apiBaseUrl.get().startsWith("https://")) {
            "Release 构建必须通过 -PcompoundApiBaseUrl=https://... 显式配置 HTTPS 后端。"
        }
        require(releaseStoreFile != null) {
            "Release 构建必须配置 RELEASE_STORE_FILE 及对应签名环境变量。"
        }
    }
}

android {
    namespace = "com.compoundjournal.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.compoundjournal.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        buildConfigField("String", "API_BASE_URL", "\"${apiBaseUrl.get().trimEnd('/')}\"")
    }

    if (releaseStoreFile != null) {
        signingConfigs.create("release") {
            storeFile = file(releaseStoreFile)
            storePassword = providers.environmentVariable("RELEASE_STORE_PASSWORD").get()
            keyAlias = providers.environmentVariable("RELEASE_KEY_ALIAS").get()
            keyPassword = providers.environmentVariable("RELEASE_KEY_PASSWORD").get()
        }
    }

    buildTypes {
        debug { applicationIdSuffix = ".debug" }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (releaseStoreFile != null) signingConfig = signingConfigs.getByName("release")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    lint { disable += "NullSafeMutableLiveData" }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.05.01")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.1")
    implementation("androidx.room:room-runtime:2.7.2")
    implementation("androidx.room:room-ktx:2.7.2")
    ksp("androidx.room:room-compiler:2.7.2")
    testImplementation("junit:junit:4.13.2")
}
