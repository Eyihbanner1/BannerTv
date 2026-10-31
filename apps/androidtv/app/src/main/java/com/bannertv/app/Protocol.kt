package com.bannertv.app

/**
 * Constants and pure helpers for the host <-> web app protocol, version 1.
 * No Android imports, so JVM unit tests run them as they are.
 */
object Protocol {
    const val VERSION: String = "1"

    /** The name the web app finds the bridge under: window.BannerAndroid. */
    const val BRIDGE_NAME: String = "BannerAndroid"

    // localStorage and IndexedDB belong to this origin. Never change it, or the path prefix, after
    // the first release: users would lose their addons, profiles and progress.
    const val ORIGIN: String = "https://appassets.androidplatform.net"
    const val START_URL: String = "$ORIGIN/assets/web/index.html"

    /** The oldest Chromium the web build supports (the LG floor too). */
    const val MIN_WEBVIEW_MAJOR: Int = 68

    const val STREAM_HLS: String = "hls"
    const val STREAM_DASH: String = "dash"

    private val TRACK_ID = Regex("""(\d{1,6}):(\d{1,6})""")
    private val HTTPS_URL = Regex("""https://[^/?#\s]+([/?#]\S*)?""", RegexOption.IGNORE_CASE)

    /** The script that hands one event object to the page, if the page is listening yet. */
    fun eventScript(json: String): String {
        // U+2028 and U+2029 are legal inside JSON strings but end the line in older JavaScript.
        val safe = json.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
        return "window.__bannerAndroid&&window.__bannerAndroid.event($safe)"
    }

    /** Whether a navigation stays inside the bundled app. Anything else is blocked. */
    fun isAppUrl(url: String): Boolean = url.startsWith("$ORIGIN/")

    /** openExternal only accepts absolute https URLs. */
    fun isExternalUrlAllowed(url: String?): Boolean = url != null && HTTPS_URL.matches(url.trim())

    /** The major version from a WebView versionName such as "138.0.7204.244", or null. */
    fun webViewMajor(versionName: String?): Int? = versionName?.trim()?.substringBefore('.')?.toIntOrNull()

    /** Splits an EngineTrack id "<groupIndex>:<trackIndex>". */
    fun parseTrackId(id: String?): Pair<Int, Int>? {
        val match = TRACK_ID.matchEntire(id ?: return null) ?: return null
        return Pair(match.groupValues[1].toInt(), match.groupValues[2].toInt())
    }

    fun trackId(groupIndex: Int, trackIndex: Int): String = "$groupIndex:$trackIndex"

    /** HLS or DASH from the load command's mime, so URLs without an extension still play. */
    fun streamType(mime: String?): String? = when (mime?.trim()?.lowercase()) {
        "application/vnd.apple.mpegurl", "application/x-mpegurl", "audio/mpegurl" -> STREAM_HLS
        "application/dash+xml" -> STREAM_DASH
        else -> null
    }

    /** Format.language as the web app expects it: "" when missing or undetermined. */
    fun language(language: String?): String =
        if (language == null || language.equals("und", ignoreCase = true)) "" else language
}
