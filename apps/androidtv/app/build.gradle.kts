import groovy.json.JsonSlurper
import javax.inject.Inject

plugins {
    alias(libs.plugins.android.application)
}

// The LG app's appinfo.json is the one place the version lives (CI checks it against the tag),
// so the APK takes its version from there instead of keeping a third copy.
val appInfoFile: File = layout.projectDirectory.file("../../webos/webos-meta/appinfo.json").asFile
val appVersionName: String = run {
    val version = (JsonSlurper().parse(appInfoFile) as? Map<*, *>)?.get("version") as? String
    if (version == null || !Regex("""\d+\.\d+\.\d+""").matches(version)) {
        throw GradleException(
            "The \"version\" in ${appInfoFile.path} must be major.minor.patch, " +
                "for example 0.1.0 (found: $version)",
        )
    }
    version
}
val appVersionCode: Int = run {
    val (major, minor, patch) = appVersionName.split('.').map { it.toIntOrNull() ?: Int.MAX_VALUE }
    // Android caps versionCode at 2100000000, and minor and patch each get three digits.
    if (major > 2099 || minor > 999 || patch > 999) {
        throw GradleException(
            "The version $appVersionName is out of range for an Android versionCode: " +
                "major must be at most 2099, minor and patch at most 999",
        )
    }
    major * 1_000_000 + minor * 1_000 + patch
}

// Release signing comes from CI secrets. Without all four, release builds use the debug key so
// that pull requests (and forks, which get no secrets) still build.
val keystorePath: String? = providers.environmentVariable("ANDROID_KEYSTORE_PATH").orNull
val keystorePassword: String? = providers.environmentVariable("ANDROID_KEYSTORE_PASSWORD").orNull
val keyAliasName: String? = providers.environmentVariable("ANDROID_KEY_ALIAS").orNull
val keyPasswordValue: String? = providers.environmentVariable("ANDROID_KEY_PASSWORD").orNull
val hasReleaseKey: Boolean =
    listOf(keystorePath, keystorePassword, keyAliasName, keyPasswordValue).all { !it.isNullOrEmpty() }

/**
 * Copies the web build (apps/webos/dist) into a generated assets folder, under web/, so
 * WebViewAssetLoader serves it at https://appassets.androidplatform.net/assets/web/index.html.
 */
abstract class CopyWebBuild : DefaultTask() {
    // Internal plus a derived file tree, not @InputDirectory: Gradle validates an @InputDirectory
    // before the task runs, so a missing dist would never reach the clear message below.
    @get:Internal
    abstract val webDist: DirectoryProperty

    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    val webFiles: FileTree
        get() = webDist.asFileTree

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @get:Inject
    abstract val fileSystem: FileSystemOperations

    @TaskAction
    fun copy() {
        val dist = webDist.get().asFile
        if (!dist.resolve("index.html").isFile) {
            throw GradleException("Build the web app first: pnpm install && pnpm build (from the repo root)")
        }
        fileSystem.sync {
            from(dist)
            into(outputDir.dir("web"))
        }
    }
}

val copyWebBuild = tasks.register<CopyWebBuild>("copyWebBuild") {
    webDist.set(layout.projectDirectory.dir("../../webos/dist"))
    outputDir.set(layout.buildDirectory.dir("generated/web"))
}

android {
    namespace = "com.bannertv.app"
    // AndroidX core 1.19 needs API 37 to compile against; the app still targets 36.
    compileSdk = 37

    defaultConfig {
        applicationId = "com.bannertv.app"
        minSdk = 25
        targetSdk = 36
        versionCode = appVersionCode
        versionName = appVersionName
        manifestPlaceholders["appLabel"] = "@string/app_name"
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = file(keystorePath!!)
                storePassword = keystorePassword
                keyAlias = keyAliasName
                keyPassword = keyPasswordValue
            }
        }
    }

    buildTypes {
        getByName("debug") {
            // Installs beside the real app, with its own name on the launcher.
            applicationIdSuffix = ".debug"
            manifestPlaceholders["appLabel"] = "BannerTV test"
        }
        getByName("release") {
            // No R8, so the @JavascriptInterface methods the web app calls can never be stripped.
            isMinifyEnabled = false
            signingConfig =
                if (hasReleaseKey) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }

    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(copyWebBuild, CopyWebBuild::outputDir)
    }
}

dependencies {
    implementation(libs.androidx.activity)
    implementation(libs.androidx.core)
    implementation(libs.androidx.webkit)
    implementation(libs.media3.exoplayer)
    implementation(libs.media3.exoplayer.dash)
    implementation(libs.media3.exoplayer.hls)
    implementation(libs.media3.ui)

    testImplementation(libs.junit)
}
