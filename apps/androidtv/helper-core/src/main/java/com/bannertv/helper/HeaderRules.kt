package com.bannertv.helper

/**
 * Which of an addon's request headers can be sent, for the Android TV app's player (through
 * Protocol) and the stream helper alike. No Android imports, so JVM unit tests run it as it is.
 */
object HeaderRules {
    /** A header name as HTTP allows it (RFC 9110 token). */
    private val HEADER_NAME = Regex("""[!#$%&'*+.^_`|~0-9A-Za-z-]+""")

    /** Headers the player sets itself: an addon's would break seeking or the connection. */
    private val PLAYER_HEADERS = setOf("host", "range", "content-length", "connection", "transfer-encoding")

    /**
     * The request headers as they can be sent: names HTTP allows, values without line breaks,
     * none the player sets itself. The web app cleans them too; this is the guard.
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
}
