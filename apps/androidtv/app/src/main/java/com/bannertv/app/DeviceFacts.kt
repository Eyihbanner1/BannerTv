package com.bannertv.app

import android.app.ActivityManager
import android.app.UiModeManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.hardware.display.DisplayManager
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.os.Build
import android.view.Display
import androidx.webkit.WebViewCompat
import org.json.JSONObject

/**
 * What the device can do, for hostInfo() and capabilities(). Each fact is worked out on its own
 * and becomes null when the device throws, so one odd API never hides the others. Called on the
 * WebView JavaBridge thread; nothing here needs the main thread.
 */
class DeviceFacts(context: Context) {
    private val app: Context = context.applicationContext

    // Listing codecs is slow on some sticks and the list never changes while the app runs.
    private val decoders: List<MediaCodecInfo> by lazy {
        MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.filter { !it.isEncoder }
    }

    fun hostInfo(): JSONObject = JSONObject()
        .put("appVersion", BuildConfig.VERSION_NAME)
        .put("versionCode", BuildConfig.VERSION_CODE)
        .put("sdk", Build.VERSION.SDK_INT)
        .put("release", Build.VERSION.RELEASE ?: "")
        .put("manufacturer", Build.MANUFACTURER ?: "")
        .put("model", Build.MODEL ?: "")
        .put("webView", fact { WebViewCompat.getCurrentWebViewPackage(app)?.versionName } ?: "")
        .put("tv", orNull(fact { isTv() }))
        .put("fireTv", orNull(fact { app.packageManager.hasSystemFeature(FEATURE_FIRE_TV) }))
        .put("lowRam", orNull(fact { isLowRam() }))

    fun capabilities(): JSONObject {
        // The display can change (another TV on the HDMI port), so only the codec list is cached.
        val display: Display? = fact { defaultDisplay() }
        val hdrTypes: Set<Int>? = if (display == null) null else fact { supportedHdrTypes(display) }
        val uhd: Boolean? = if (display == null) null else fact { isUhd(display) }
        val hdr10: Boolean? = hdrTypes?.contains(Display.HdrCapabilities.HDR_TYPE_HDR10)
        val dolbyVision: Boolean? =
            if (hdrTypes == null) {
                null
            } else {
                fact { Display.HdrCapabilities.HDR_TYPE_DOLBY_VISION in hdrTypes && hasDecoder(MIME_DOLBY_VISION) }
            }
        return JSONObject()
            .put("uhd", orNull(uhd))
            .put("hdr10", orNull(hdr10))
            .put("dolbyVision", orNull(dolbyVision))
            .put("hevc", orNull(fact { hasDecoder(MIME_HEVC) }))
            .put("av1", orNull(fact { hasDecoder(MIME_AV1, hardwareOnly = true) }))
            .put("dts", orNull(fact { hasDts() }))
            .put("truehd", orNull(fact { hasTrueHd() }))
    }

    private fun isTv(): Boolean {
        if (app.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)) return true
        val uiMode = app.getSystemService(UiModeManager::class.java)
        return uiMode?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION
    }

    private fun isLowRam(): Boolean? = app.getSystemService(ActivityManager::class.java)?.isLowRamDevice

    private fun defaultDisplay(): Display? =
        app.getSystemService(DisplayManager::class.java)?.getDisplay(Display.DEFAULT_DISPLAY)

    private fun isUhd(display: Display): Boolean = display.supportedModes.any { it.physicalWidth >= UHD_WIDTH }

    @Suppress("DEPRECATION") // HdrCapabilities.getSupportedHdrTypes, still the only source before API 34
    private fun supportedHdrTypes(display: Display): Set<Int> {
        val types = HashSet<Int>()
        display.hdrCapabilities?.supportedHdrTypes?.forEach { types.add(it) }
        if (Build.VERSION.SDK_INT >= 34) {
            display.mode.supportedHdrTypes.forEach { types.add(it) }
        }
        return types
    }

    private fun hasDecoder(mime: String, hardwareOnly: Boolean = false): Boolean = decoders.any { info ->
        info.supportedTypes.any { it.equals(mime, ignoreCase = true) } && (!hardwareOnly || isHardware(info))
    }

    // Software AV1 cannot keep up at 4K on a TV stick, so only hardware decoders count for it.
    private fun isHardware(info: MediaCodecInfo): Boolean {
        if (Build.VERSION.SDK_INT >= 29) return info.isHardwareAccelerated
        val name = info.name.lowercase()
        return !name.startsWith("omx.google.") && !name.startsWith("c2.android.")
    }

    /** Encodings the HDMI (or ARC/eARC) output accepts for passthrough. */
    private fun hdmiEncodings(): Set<Int> {
        val audio = app.getSystemService(AudioManager::class.java) ?: return emptySet()
        val hdmiTypes = mutableSetOf(AudioDeviceInfo.TYPE_HDMI, AudioDeviceInfo.TYPE_HDMI_ARC)
        if (Build.VERSION.SDK_INT >= 31) hdmiTypes.add(AudioDeviceInfo.TYPE_HDMI_EARC)
        val encodings = HashSet<Int>()
        for (device in audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
            if (device.type in hdmiTypes) device.encodings.forEach { encodings.add(it) }
        }
        return encodings
    }

    private fun hasDts(): Boolean {
        val encodings = hdmiEncodings()
        return AudioFormat.ENCODING_DTS in encodings ||
            AudioFormat.ENCODING_DTS_HD in encodings ||
            hasDecoder(MIME_DTS)
    }

    private fun hasTrueHd(): Boolean = AudioFormat.ENCODING_DOLBY_TRUEHD in hdmiEncodings() || hasDecoder(MIME_TRUEHD)

    private inline fun <T> fact(block: () -> T): T? = try {
        block()
    } catch (e: Exception) {
        null
    } catch (e: LinkageError) {
        // Vendor builds sometimes lack a method their API level promises.
        null
    }

    private fun orNull(value: Any?): Any = value ?: JSONObject.NULL

    private companion object {
        const val FEATURE_FIRE_TV = "amazon.hardware.fire_tv"
        const val UHD_WIDTH = 3840
        const val MIME_HEVC = "video/hevc"
        const val MIME_AV1 = "video/av01"
        const val MIME_DOLBY_VISION = "video/dolby-vision"
        const val MIME_DTS = "audio/vnd.dts"
        const val MIME_TRUEHD = "audio/true-hd"
    }
}
