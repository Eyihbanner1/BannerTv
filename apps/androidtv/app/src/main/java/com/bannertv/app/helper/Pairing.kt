package com.bannertv.app.helper

import java.security.SecureRandom

/**
 * Pairing an LG with the helper: the helper shows a six-digit code, the LG sends it once and
 * gets back a long key it uses from then on. Every few wrong codes the code changes, so
 * guessing it on the home network gets nowhere.
 *
 * keys are the keys handed out before (kept by the app); save is told whenever they change.
 */
class Pairing(
    keys: Set<String>,
    private val save: (Set<String>) -> Unit,
) {
    private val random = SecureRandom()
    private val keys = LinkedHashSet(keys)
    private var failures = 0

    @get:Synchronized
    var code: String = newCode()
        private set

    /** A new key for the right code, else null. The code changes once it has been used. */
    @Synchronized
    fun pair(asked: String?): String? {
        if (asked == null || !constantTimeEquals(asked.trim(), code)) {
            failures++
            if (failures >= MAX_FAILURES) rotate()
            return null
        }
        val bytes = ByteArray(KEY_BYTES)
        random.nextBytes(bytes)
        val key = Base64Url.encode(bytes)
        keys.add(key)
        while (keys.size > MAX_KEYS) keys.remove(keys.first())
        save(keys.toSet())
        rotate()
        return key
    }

    @Synchronized
    fun isPaired(key: String?): Boolean = key != null && keys.any { constantTimeEquals(it, key) }

    /** Forgets one TV's key (the TV unpaired itself). True if it was known. */
    @Synchronized
    fun forget(key: String?): Boolean {
        val known = key?.let { asked -> keys.firstOrNull { constantTimeEquals(it, asked) } } ?: return false
        keys.remove(known)
        save(keys.toSet())
        return true
    }

    /** Forgets every paired TV. */
    @Synchronized
    fun forgetAll() {
        keys.clear()
        save(emptySet())
        rotate()
    }

    @Synchronized
    fun pairedCount(): Int = keys.size

    private fun rotate() {
        code = newCode()
        failures = 0
    }

    private fun newCode(): String = (random.nextInt(1_000_000)).toString().padStart(6, '0')

    private fun constantTimeEquals(a: String, b: String): Boolean {
        if (a.length != b.length) return false
        var diff = 0
        for (i in a.indices) diff = diff or (a[i].code xor b[i].code)
        return diff == 0
    }

    companion object {
        const val MAX_FAILURES: Int = 5
        const val MAX_KEYS: Int = 8
        private const val KEY_BYTES = 24
    }
}
