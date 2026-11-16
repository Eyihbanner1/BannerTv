package com.bannertv.app

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** The hash reader end to end, against a stand-in file server on this machine. */
class StreamHashReaderTest {
    private lateinit var server: HttpServer
    private lateinit var pool: ExecutorService
    private val seen = Collections.synchronizedList(mutableListOf<Map<String, String?>>())
    private val body = ByteArray(SIZE) { ((it * 7 + 13) and 0xff).toByte() }
    private val small = ByteArray(100_000) { (it and 0xff).toByte() }
    private val oneUse = AtomicInteger(0)
    private val oneUseAsked = Collections.synchronizedMap(mutableMapOf<String, Int>())

    // What the handler of a whole file sent for a range managed to write before the reader left.
    private val whole = 64L * 1024 * 1024
    private val wholeWritten = AtomicLong(0)
    @Volatile private var wholeClosedEarly = false
    private val wholeDone = CountDownLatch(1)

    // How much of the first 64 KB the trickling host has sent.
    private val trickled = AtomicInteger(0)

    private val base get() = "http://127.0.0.1:${server.address.port}"
    private val expected
        get() = StreamHash.hash(SIZE.toLong(), body.copyOfRange(0, CHUNK), body.copyOfRange(SIZE - CHUNK, SIZE))!!

    @Before
    fun setUp() {
        server = HttpServer.create(InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0)
        server.createContext("/") { exchange ->
            val path = exchange.requestURI.path
            val range = exchange.requestHeaders.getFirst("Range")
            seen.add(
                mapOf(
                    "path" to path,
                    "range" to range,
                    "referer" to exchange.requestHeaders.getFirst("Referer"),
                    "ua" to exchange.requestHeaders.getFirst("User-Agent"),
                    "encoding" to exchange.requestHeaders.getFirst("Accept-Encoding"),
                ),
            )
            try {
                handle(exchange, path, range)
            } catch (e: IOException) {
                // The reader went away.
            } finally {
                exchange.close()
            }
        }
        pool = Executors.newCachedThreadPool()
        server.executor = pool
        server.start()
    }

    @After
    fun tearDown() {
        server.stop(0)
        pool.shutdownNow()
    }

    private fun handle(exchange: HttpExchange, path: String, range: String?) {
        when {
            path == "/file" -> serve(exchange, body, range)
            path == "/hop1" -> redirect(exchange, "/hop2")
            path == "/hop2" -> redirect(exchange, "$base/file")
            path.startsWith("/r") -> {
                // /rN redirects N more times before the file.
                val left = path.removePrefix("/r").toInt()
                redirect(exchange, if (left == 0) "/file" else "/r${left - 1}")
            }
            path == "/one-use" -> redirect(exchange, "/landed/${oneUse.incrementAndGet()}")
            path.startsWith("/landed/") -> {
                // A link good for one read: it refuses every read after the first.
                val asked = oneUseAsked.merge(path, 1, Int::plus)!!
                if (asked == 1) serve(exchange, body, range) else status(exchange, 403)
            }
            path == "/busy" -> status(exchange, 503)
            path == "/refused" -> status(exchange, 403)
            path == "/whole" -> sendWhole(exchange)
            path == "/liar" -> {
                // The end read names another file's size.
                val total = if (range == StreamHash.rangeHeader(0)) SIZE else 999_999
                serve(exchange, body, range, total = total)
            }
            path == "/no-content-range" -> serve(exchange, body, range, contentRange = false)
            path == "/small" -> serve(exchange, small, range)
            path == "/slow" -> {
                Thread.sleep(3000)
                serve(exchange, body, range)
            }
            path == "/trickle" -> trickle(exchange)
            else -> status(exchange, 404)
        }
    }

    private fun redirect(exchange: HttpExchange, location: String) {
        exchange.responseHeaders.add("Location", location)
        exchange.sendResponseHeaders(302, -1)
    }

    private fun status(exchange: HttpExchange, code: Int) {
        exchange.sendResponseHeaders(code, -1)
    }

    /** Real ranges: 206 with the slice asked for, or the whole file without a Range. */
    private fun serve(
        exchange: HttpExchange,
        file: ByteArray,
        range: String?,
        total: Int = file.size,
        contentRange: Boolean = true,
    ) {
        val match = range?.let { Regex("""bytes=(\d+)-(\d+)""").matchEntire(it) }
        if (match == null) {
            exchange.sendResponseHeaders(200, file.size.toLong())
            exchange.responseBody.write(file)
            return
        }
        val start = match.groupValues[1].toInt()
        val end = minOf(match.groupValues[2].toInt(), file.size - 1)
        if (contentRange) exchange.responseHeaders.add("Content-Range", "bytes $start-$end/$total")
        exchange.sendResponseHeaders(206, (end - start + 1).toLong())
        exchange.responseBody.write(file, start, end - start + 1)
    }

    /**
     * The first 64 KB for a range, a little at a time: 1 KB every 100 ms, each piece well inside
     * the read timeout, the whole over 6 s.
     */
    private fun trickle(exchange: HttpExchange) {
        exchange.responseHeaders.add("Content-Range", "bytes 0-${CHUNK - 1}/$SIZE")
        exchange.sendResponseHeaders(206, CHUNK.toLong())
        val out = exchange.responseBody
        var sent = 0
        try {
            while (sent < CHUNK) {
                out.write(body, sent, 1024)
                out.flush()
                sent += 1024
                trickled.set(sent)
                Thread.sleep(100)
            }
        } catch (e: InterruptedException) {
            // The server is stopping.
        }
    }

    /** The whole of a large file for a range, counting what the reader's socket took. */
    private fun sendWhole(exchange: HttpExchange) {
        try {
            exchange.sendResponseHeaders(200, whole)
            val piece = ByteArray(CHUNK)
            val out = exchange.responseBody
            while (wholeWritten.get() < whole) {
                out.write(piece)
                wholeWritten.addAndGet(piece.size.toLong())
            }
            out.flush()
        } catch (e: IOException) {
            wholeClosedEarly = true
        } finally {
            wholeDone.countDown()
        }
    }

    private fun reader(deadlineMs: Long = 12_000) =
        StreamHashReader(userAgent = "BannerTV/test", deadlineMs = deadlineMs)

    private fun request(path: String, size: Long? = null, headers: Map<String, String> = emptyMap()) =
        HashRequest(id = 1, url = base + path, size = size, headers = headers)

    private fun read(request: HashRequest, deadlineMs: Long = 12_000) = reader(deadlineMs).read(request) { false }

    @Test
    fun readsTheHashWithTwoRanges() {
        // No redirect: both reads go through the stream's link, each a walk, as on the page
        // ("reads both ends through the stream's link when the fetch can't say where it landed").
        val result = read(request("/file"))
        assertEquals(HashResult.Found(expected, SIZE.toLong(), 2, null), result)
        val ranges = listOf(StreamHash.rangeHeader(0), StreamHash.rangeHeader((SIZE - CHUNK).toLong()))
        assertEquals(ranges, seen.map { it["range"] })
    }

    @Test
    fun theEndIsReadStraightFromWhereTheRedirectsLed() {
        val result = read(request("/hop1"))
        assertEquals(HashResult.Found(expected, SIZE.toLong(), 1, null), result)
        assertEquals(listOf("/hop1", "/hop2", "/file", "/file"), seen.map { it["path"] })
        assertEquals(StreamHash.rangeHeader((SIZE - CHUNK).toLong()), seen.last()["range"])
    }

    @Test
    fun fiveRedirectsAreFollowedAndSixRefused() {
        assertTrue(read(request("/r4")) is HashResult.Found)
        seen.clear()
        assertEquals(HashResult.Failed("refused", "start", 1), read(request("/r5")))
        // Never past the sixth.
        assertEquals(6, seen.size)
        assertFalse(seen.any { it["path"] == "/file" })
    }

    @Test
    fun aLandedLinkThatRefusesTheEndGoesBackThroughTheStreamsLink() {
        val result = read(request("/one-use"))
        assertEquals(HashResult.Found(expected, SIZE.toLong(), 2, "end"), result)
        assertEquals(listOf("/one-use", "/landed/1", "/landed/1", "/one-use", "/landed/2"), seen.map { it["path"] })
    }

    @Test
    fun aBusyOrRefusingServerAtTheStart() {
        assertEquals(HashResult.Failed("busy", "start", 1), read(request("/busy")))
        assertEquals(HashResult.Failed("refused", "start", 1), read(request("/refused")))
    }

    @Test
    fun theWholeFileForARangeIsNoRangeAndIsNotDownloaded() {
        assertEquals(HashResult.Failed("no range", "start", 1), read(request("/whole")))
        assertTrue(wholeDone.await(10, TimeUnit.SECONDS))
        assertTrue(wholeClosedEarly)
        assertTrue(wholeWritten.get() < whole)
    }

    @Test
    fun anEndOfAnotherSizeIsRefused() {
        assertEquals(HashResult.Failed("refused", "end", 2), read(request("/liar")))
    }

    @Test
    fun theSizeIsAskedForOnlyWhenNothingGaveIt() {
        // Start, size and end each walk the stream's link: no redirect led anywhere else.
        assertEquals(HashResult.Found(expected, SIZE.toLong(), 3, null), read(request("/no-content-range")))
        assertEquals(1, seen.count { it["range"] == null })
        seen.clear()

        assertEquals(
            HashResult.Found(expected, SIZE.toLong(), 2, null),
            read(request("/no-content-range", size = SIZE.toLong())),
        )
        assertEquals(0, seen.count { it["range"] == null })
    }

    @Test
    fun aSmallFileIsTooSmall() {
        val result = read(request("/small")) as HashResult.Failed
        assertEquals("too small", result.why)
        assertEquals("start", result.step)
    }

    @Test
    fun givesUpAtTheDeadline() {
        val started = System.nanoTime()
        val result = read(request("/slow"), deadlineMs = 2000)
        val took = (System.nanoTime() - started) / 1_000_000
        assertEquals(HashResult.Failed("timed out", "start", 1), result)
        assertTrue("took $took ms", took < 3000)
    }

    @Test
    fun givesUpAtTheDeadlineWhileTheBytesTrickleIn() {
        val started = System.nanoTime()
        val result = read(request("/trickle"), deadlineMs = 1500)
        val took = (System.nanoTime() - started) / 1_000_000
        assertEquals(HashResult.Failed("timed out", "start", 1), result)
        assertTrue("took $took ms", took < 2500)
        assertTrue(trickled.get() < CHUNK)
    }

    @Test
    fun aNewerRequestCancelsItWhileTheBytesTrickleIn() {
        val started = System.nanoTime()
        val result = reader().read(request("/trickle")) { trickled.get() >= 4096 }
        val took = (System.nanoTime() - started) / 1_000_000
        assertEquals(HashResult.Cancelled, result)
        assertTrue("took $took ms", took < 2500)
    }

    @Test
    fun aNewerRequestCancelsIt() {
        val result = reader().read(request("/file")) { seen.size >= 1 }
        assertEquals(HashResult.Cancelled, result)
        assertEquals(1, seen.size)
    }

    @Test
    fun sendsTheAddonsHeadersAndAsksForTheBytesAsTheyAre() {
        read(request("/file", headers = mapOf("Referer" to "https://addon.example/", "User-Agent" to "AddonAgent/2")))
        for (asked in seen) {
            assertEquals("https://addon.example/", asked["referer"])
            assertEquals("AddonAgent/2", asked["ua"])
            assertEquals("identity", asked["encoding"])
        }
        seen.clear()
        read(request("/file", headers = mapOf("accept-encoding" to "gzip")))
        assertEquals("BannerTV/test", seen.first()["ua"])
        assertEquals("identity", seen.first()["encoding"])
        assertNull(seen.first()["referer"])
    }

    @Test
    fun theEventNeverCarriesTheLink() {
        val port = server.address.port.toString()
        val results =
            listOf(
                read(request("/file")),
                read(request("/one-use")),
                read(request("/busy")),
                read(request("/liar")),
                read(request("/small")),
            )
        for (result in results) {
            val fields = hashEventFields(9, result)
            assertEquals(9, fields["id"])
            for (value in fields.values) {
                val text = value.toString()
                assertFalse(text, text.contains("://"))
                assertFalse(text, text.contains("127.0.0.1"))
                assertFalse(text, text.contains(port))
            }
        }
        assertEquals(setOf("id", "hash", "size", "walks"), hashEventFields(1, results[0]).keys)
        assertEquals(setOf("id", "hash", "size", "walks", "fellBack"), hashEventFields(1, results[1]).keys)
        assertEquals(setOf("id", "failed", "step", "walks"), hashEventFields(1, results[2]).keys)
        assertFalse(request("/file").toString().contains("://"))
    }

    private companion object {
        const val SIZE = 300_000
        const val CHUNK = StreamHash.CHUNK
    }
}
