package com.bannertv.helper

import java.net.URI

/**
 * HLS playlists name further playlists, video chunks and keys. For those to reach the add-on's
 * server with its headers too, the helper points every one of them back at itself.
 */
object Playlist {
    private val URI_ATTRIBUTE = Regex("""URI="([^"]*)"""")

    private val MIME_TYPES =
        setOf("application/vnd.apple.mpegurl", "application/x-mpegurl", "audio/mpegurl", "audio/x-mpegurl")

    /** Whether a response is an HLS playlist, from its type or, failing that, its file name. */
    fun isPlaylist(contentType: String?, target: URI): Boolean {
        val type = contentType?.substringBefore(';')?.trim()?.lowercase()
        if (type != null && type in MIME_TYPES) return true
        val path = target.rawPath?.lowercase() ?: return false
        return path.endsWith(".m3u8") || path.endsWith(".m3u")
    }

    /**
     * The playlist with every address it names (relative to base, the playlist's own address
     * after redirects) replaced by link(absolute address). Addresses that are not http or https,
     * such as skd:// or data: keys, are left alone.
     */
    fun rewrite(text: String, base: URI, link: (URI) -> String): String =
        text.lines().joinToString("\n") { raw ->
            val line = raw.trimEnd('\r')
            when {
                line.isBlank() -> line
                line.startsWith("#EXT") ->
                    URI_ATTRIBUTE.replace(line) { match ->
                        val target = resolve(base, match.groupValues[1])
                        "URI=\"" + (if (target == null) match.groupValues[1] else link(target)) + "\""
                    }
                line.startsWith("#") -> line
                else -> resolve(base, line.trim())?.let(link) ?: line
            }
        }

    private fun resolve(base: URI, reference: String): URI? =
        try {
            val target = base.resolve(URI(reference))
            val scheme = target.scheme?.lowercase()
            if (scheme == "http" || scheme == "https") target else null
        } catch (e: Exception) {
            null
        }
}
