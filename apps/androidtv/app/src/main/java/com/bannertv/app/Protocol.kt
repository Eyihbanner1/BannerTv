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

    /** A header name as HTTP allows it (RFC 9110 token). */
    private val HEADER_NAME = Regex("""[!#$%&'*+.^_`|~0-9A-Za-z-]+""")

    /** Headers the player sets itself: an addon's would break seeking or the connection. */
    private val PLAYER_HEADERS = setOf("host", "range", "content-length", "connection", "transfer-encoding")

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

    /**
     * The load command's request headers as they can be sent: names HTTP allows, values without
     * line breaks, none the player sets itself. The web app cleans them too; this is the guard.
     */
    fun requestHeaders(asked: Map<String, String?>): Map<String, String> =
        asked.entries
            .filter { (name, value) ->
                value != null &&
                    HEADER_NAME.matches(name) &&
                    name.lowercase() !in PLAYER_HEADERS &&
                    value.none { it == '\r' || it == '\n' || it == '\u0000' }
            }.associate { (name, value) -> name to value!! }

    /** The User-Agent among request headers, whatever its case, or null. */
    fun userAgent(headers: Map<String, String>): String? =
        headers.entries.firstOrNull { it.key.equals("User-Agent", ignoreCase = true) }?.value

    /** Format.language as the web app expects it: "" when missing or undetermined. */
    fun language(language: String?): String =
        if (language == null || language.equals("und", ignoreCase = true)) "" else language
}
