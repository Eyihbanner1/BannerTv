package com.bannertv.app

import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The page's hash reads on their own thread: which answers go back to the page. */
class HashReadsTest {
    private val sent = Collections.synchronizedList(mutableListOf<Map<String, Any>>())
    private val answered = CountDownLatch(1)
    private var reads: HashReads? = null

    private fun request(id: Int) =
        HashRequest(id = id, url = "https://cdn.example.com/film.mkv", size = null, headers = emptyMap())

    private fun found(n: Int) = HashResult.Found(hash = "%016x".format(n), size = 300_000L, walks = 1, fellBack = null)

    private fun start(read: (HashRequest, () -> Boolean) -> HashResult): HashReads {
        val made =
            HashReads(read = read) { fields ->
                sent.add(fields)
                answered.countDown()
            }
        reads = made
        return made
    }

    @After
    fun tearDown() {
        reads?.close()
    }

    @Test
    fun answersARead() {
        val hashes = start { request, _ -> found(request.id) }
        hashes.submit(request(7))
        assertTrue(answered.await(5, TimeUnit.SECONDS))
        assertEquals(listOf(hashEventFields(7, found(7))), sent.toList())
    }

    @Test
    fun aReadThatEndsAfterANewerRequestNeverAnswers() {
        val reading = CountDownLatch(1)
        val newer = CountDownLatch(1)
        val hashes =
            start { request, _ ->
                if (request.id == 1) {
                    // Past its last look at whether it was cancelled, as a read in its end read is.
                    reading.countDown()
                    newer.await(5, TimeUnit.SECONDS)
                }
                found(request.id)
            }
        hashes.submit(request(1))
        assertTrue(reading.await(5, TimeUnit.SECONDS))
        // The page reloads and its first play asks again.
        hashes.submit(request(2))
        newer.countDown()
        assertTrue(answered.await(5, TimeUnit.SECONDS))
        // Read on the same thread, after the first: nothing else comes after it.
        hashes.close()
        assertEquals(listOf(2), sent.map { it["id"] })
        assertEquals(found(2).hash, sent.single()["hash"])
    }

    @Test
    fun aCancelledReadNeverAnswers() {
        val hashes = start { _, _ -> HashResult.Cancelled }
        hashes.submit(request(3))
        assertFalse(answered.await(300, TimeUnit.MILLISECONDS))
        assertEquals(emptyList<Map<String, Any>>(), sent.toList())
    }
}
