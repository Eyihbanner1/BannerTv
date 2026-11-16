package com.bannertv.app

import com.bannertv.helper.HeaderRules

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

    /** What the page may ask of the stream helper through helper(). */
    val HELPER_COMMANDS: Set<String> = setOf("start", "stop", "forget")

    const val STREAM_HLS: String = "hls"
    const val STREAM_DASH: String = "dash"

    private val TRACK_ID = Regex("""(\d{1,6}):(\d{1,6})""")

    private val HTTPS_URL = Regex("""https://[^/?#\s]+([/?#]\S*)?""", RegexOption.IGNORE_CASE)

    private val HASH_URL = Regex("""^https?://\S+$""", RegexOption.IGNORE_CASE)

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

    /**
     * The load command's request headers as they can be sent: names HTTP allows, values without
     * line breaks, none the player sets itself. The rules are the stream helper's too (HeaderRules).
     */
    fun requestHeaders(asked: Map<String, String?>): Map<String, String> = HeaderRules.requestHeaders(asked)

    /** The User-Agent among request headers, whatever its case, or null. */
    fun userAgent(headers: Map<String, String>): String? = HeaderRules.userAgent(headers)

    /** hash() reads only an http or https link, with no spaces. */
    fun isHashUrl(url: String?): Boolean = url != null && HASH_URL.matches(url.trim())

    /**
     * What hash() asks for, or null when it can't be read: an id the answer goes back with, a
     * link, the size when the page knows it (null for 0 or less), and the addon's request headers
     * as they can be sent, as the player sends them.
     */
    fun hashRequest(id: Int, url: String?, size: Long, asked: Map<String, String?>): HashRequest? {
        if (id <= 0 || url == null || !isHashUrl(url)) return null
        val known = if (size > 0) size else null
        return HashRequest(id = id, url = url.trim(), size = known, headers = requestHeaders(asked))
    }

    /** Format.language as the web app expects it: "" when missing or undetermined. */
    fun language(language: String?): String =
        if (language == null || language.equals("und", ignoreCase = true)) "" else language
}
