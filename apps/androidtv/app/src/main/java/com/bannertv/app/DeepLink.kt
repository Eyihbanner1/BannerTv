package com.bannertv.app

import java.io.UnsupportedEncodingException
import java.net.URI
import java.net.URISyntaxException
import java.net.URLDecoder
import java.net.URLEncoder

/** A title to open from outside the app, such as a Watch Next card: ids only, never an addon's address. */
data class OpenLink(val type: String, val meta: String, val video: String?)

/**
 * The app's links, bannertv://open?type=…&meta=…&video=…, which Watch Next cards open. Plain Java
 * URI handling rather than android.net.Uri, so the JVM unit tests run it as it is. Any app on the
 * device can send one, so a link is read strictly, and the page checks what it is given again.
 */
object DeepLink {
    const val SCHEME: String = "bannertv"
    const val HOST: String = "open"

    private const val MAX_ID: Int = 300
    private val TYPE = Regex("""[a-z0-9_-]{1,32}""")

    /** Whether `type` looks like a content type: a short lowercase word such as movie or series. */
    fun isType(type: String): Boolean = TYPE.matches(type)

    /** Whether `id` can be an addon's id: some text of a sane length, with no control characters. */
    fun isId(id: String): Boolean = id.isNotEmpty() && id.length <= MAX_ID && id.none { it < ' ' }

    /** The link that opens `link`, each value encoded so an id's colons and slashes survive. */
    fun build(link: OpenLink): String {
        val query = buildList {
            add("type=${encode(link.type)}")
            add("meta=${encode(link.meta)}")
            link.video?.let { add("video=${encode(it)}") }
        }
        return "$SCHEME://$HOST?${query.joinToString("&")}"
    }

    /** The title a link opens, or null when it is not one of the app's links or is malformed. */
    fun parse(link: String?): OpenLink? {
        if (link == null) return null
        val uri =
            try {
                URI(link)
            } catch (e: URISyntaxException) {
                return null
            }
        if (!SCHEME.equals(uri.scheme, ignoreCase = true) || uri.host != HOST) return null
        val values = HashMap<String, String>()
        for (pair in (uri.rawQuery ?: return null).split('&')) {
            val name = pair.substringBefore('=')
            val value = decode(pair.substringAfter('=', "")) ?: return null
            // The first of a repeated name counts, as the page's own URLSearchParams.get would.
            if (name !in values) values[name] = value
        }
        val type = values["type"]?.takeIf(::isType) ?: return null
        val meta = values["meta"]?.takeIf(::isId) ?: return null
        return OpenLink(type, meta, values["video"]?.takeIf(::isId))
    }

    private fun encode(text: String): String = URLEncoder.encode(text, "UTF-8")

    private fun decode(text: String): String? =
        try {
            URLDecoder.decode(text, "UTF-8")
        } catch (e: IllegalArgumentException) {
            null
        } catch (e: UnsupportedEncodingException) {
            null
        }
}
