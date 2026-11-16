package com.bannertv.app

import java.math.BigInteger
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Random
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamHashTest {
    private val chunk = StreamHash.CHUNK

    /** The sum the long way, modulo 2^64, as the hash defines it. */
    private fun reference(size: Long, head: ByteArray, tail: ByteArray): String {
        val modulus = BigInteger.ONE.shiftLeft(64)
        var sum = BigInteger.valueOf(size)
        for (bytes in arrayOf(head, tail)) {
            val words = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
            for (at in 0 until chunk step 8) {
                val word = BigInteger.valueOf(words.getLong(at)).mod(modulus)
                sum = sum.add(word).mod(modulus)
            }
        }
        return sum.toString(16).padStart(16, '0')
    }

    private fun pattern(f: (Int) -> Int) = ByteArray(chunk) { f(it).toByte() }

    @Test
    fun theHashIsTheSumOfTheSizeAndEveryWordModulo2To64() {
        val random = Random(7)
        repeat(5) {
            val head = ByteArray(chunk).also(random::nextBytes)
            val tail = ByteArray(chunk).also(random::nextBytes)
            val size = 200_000L + random.nextInt(1_000_000_000)
            assertEquals(reference(size, head, tail), StreamHash.hash(size, head, tail))
        }
    }

    @Test
    fun carriesRunAcrossAllFourWords() {
        // Every byte 0xff: each word is 2^64 - 1, so the sum wraps on every one.
        val full = ByteArray(chunk) { 0xff.toByte() }
        assertEquals(reference(131_072L, full, full), StreamHash.hash(131_072L, full, full))
        val size = (1L shl 40) + 12345
        val head = pattern { if (it % 8 == 7) 0xff else 0x00 }
        val tail = pattern { if (it % 2 == 1) 0xff else 0x01 }
        assertEquals(reference(size, head, tail), StreamHash.hash(size, head, tail))
    }

    // The same input as the page's test "the Android app's reader agrees" (stream-hash.test.ts).
    @Test
    fun agreesWithThePage() {
        val head = pattern { (it * 31 + 7) and 0xff }
        val tail = pattern { (it * 17 + 3) and 0xff }
        val hash = StreamHash.hash(1_000_000_007L, head, tail)
        assertEquals("5f6060609bfb0a07", hash)
        assertEquals(reference(1_000_000_007L, head, tail), hash)
    }

    @Test
    fun noHashForShortChunksOrASmallFile() {
        val bytes = ByteArray(chunk)
        assertNull(StreamHash.hash(1_000_000L, ByteArray(chunk - 1), bytes))
        assertNull(StreamHash.hash(1_000_000L, bytes, ByteArray(chunk + 1)))
        assertNull(StreamHash.hash(2L * chunk - 1, bytes, bytes))
        assertEquals("0000000000020000", StreamHash.hash(2L * chunk, bytes, bytes))
    }

    @Test
    fun readsTheSizeFromContentRange() {
        assertEquals(123456L, StreamHash.totalFrom("bytes 0-65535/123456"))
        assertEquals(9L, StreamHash.totalFrom("bytes */9"))
        assertEquals(9L, StreamHash.totalFrom("bytes 0-1/9  "))
        assertNull(StreamHash.totalFrom("bytes 0-65535/*"))
        assertNull(StreamHash.totalFrom("garbage"))
        assertNull(StreamHash.totalFrom(""))
        assertNull(StreamHash.totalFrom(null))
    }

    @Test
    fun busyIsTheServerNotTheLink() {
        for (status in listOf(408, 425, 429, 500, 503)) assertTrue("$status", StreamHash.isBusy(status))
        for (status in listOf(404, 403, 200, 206)) assertFalse("$status", StreamHash.isBusy(status))
    }

    @Test
    fun asksForOneChunk() {
        assertEquals("bytes=0-65535", StreamHash.rangeHeader(0))
        assertEquals("bytes=234464-299999", StreamHash.rangeHeader(300_000L - chunk))
    }
}
