package com.bannertv.helper

import java.net.URI
import java.security.SecureRandom

/**
 * The streams the LG has handed the helper, each under a secret token. A token works only for
 * the stream it was made for and the files that stream's playlists name, and lapses after
 * IDLE_MS without use. Kept in memory only: links and headers are never written down.
 */
class StreamLinks(
    private val now: () -> Long = System::currentTimeMillis,
    private val idleMs: Long = IDLE_MS,
    private val max: Int = MAX_LINKS,
) {
    class Link(val target: URI, val headers: Map<String, String>, var lastUsed: Long)

    private val random = SecureRandom()
    private val links = LinkedHashMap<String, Link>()

    @Synchronized
    fun add(target: URI, headers: Map<String, String>): String {
        prune()
        val token = newToken()
        links[token] = Link(target, headers, now())
        while (links.size > max) links.remove(links.keys.first())
        return token
    }

    /** The link for a token, marked as just used, or null when it is unknown or lapsed. */
    @Synchronized
    fun use(token: String): Link? {
        prune()
        val link = links[token] ?: return null
        link.lastUsed = now()
        return link
    }

    @Synchronized
    fun clear() = links.clear()

    @Synchronized
    fun size(): Int = links.size

    private fun prune() {
        val cutoff = now() - idleMs
        links.entries.removeAll { it.value.lastUsed < cutoff }
    }

    private fun newToken(): String {
        val bytes = ByteArray(TOKEN_BYTES)
        random.nextBytes(bytes)
        return Base64Url.encode(bytes)
    }

    companion object {
        const val IDLE_MS: Long = 4 * 60 * 60 * 1000L
        const val MAX_LINKS: Int = 64
        private const val TOKEN_BYTES = 16
    }
}
