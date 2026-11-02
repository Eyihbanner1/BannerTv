package com.bannertv.app.helper

/**
 * URL-safe base64 without padding (RFC 4648 section 5). java.util.Base64 needs API 26 and
 * android.util.Base64 is missing from JVM unit tests, so the helper carries its own.
 */
object Base64Url {
    private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

    fun encode(bytes: ByteArray): String {
        val out = StringBuilder((bytes.size * 4 + 2) / 3)
        var i = 0
        while (i < bytes.size) {
            val b0 = bytes[i].toInt() and 0xff
            val b1 = if (i + 1 < bytes.size) bytes[i + 1].toInt() and 0xff else 0
            val b2 = if (i + 2 < bytes.size) bytes[i + 2].toInt() and 0xff else 0
            val n = (b0 shl 16) or (b1 shl 8) or b2
            out.append(ALPHABET[n shr 18 and 63])
            out.append(ALPHABET[n shr 12 and 63])
            if (i + 1 < bytes.size) out.append(ALPHABET[n shr 6 and 63])
            if (i + 2 < bytes.size) out.append(ALPHABET[n and 63])
            i += 3
        }
        return out.toString()
    }

    /** The bytes, or null when the text is not URL-safe base64 without padding. */
    fun decode(text: String): ByteArray? {
        if (text.length % 4 == 1) return null
        val out = java.io.ByteArrayOutputStream(text.length * 3 / 4)
        var buffer = 0
        var bits = 0
        for (ch in text) {
            val value = ALPHABET.indexOf(ch)
            if (value < 0) return null
            buffer = (buffer shl 6) or value
            bits += 6
            if (bits >= 8) {
                bits -= 8
                out.write(buffer shr bits and 0xff)
            }
        }
        // Leftover bits must be zero, so every byte string has exactly one spelling.
        if (buffer and ((1 shl bits) - 1) != 0) return null
        return out.toByteArray()
    }
}
