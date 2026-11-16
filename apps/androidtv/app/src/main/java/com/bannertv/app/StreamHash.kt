package com.bannertv.app

import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * The OpenSubtitles hash of the video file, read here rather than by the page: the WebView's
 * fetch can't follow a debrid service's redirects across origins, and the hosts it lands on send
 * no cross-origin headers. The steps are the page's own (apps/webos/src/player/stream-hash.ts):
 * the first 64 KB through the stream's link, the size and the last 64 KB straight from where it
 * landed, and once that refuses, through the stream's link again. No Android imports, so JVM unit
 * tests run it as it is. Nothing here is logged, and no link leaves it.
 */
object StreamHash {
    /** Bytes read from each end of the file. */
    const val CHUNK: Int = 65536

    private val TOTAL = Regex("""/(\d+)\s*$""")

    /**
     * The file size plus every little-endian 64-bit word of the first and last 64 KB, modulo
     * 2^64, as 16 lowercase hex digits. Null for a file shorter than both chunks, or chunks of the
     * wrong length.
     */
    fun hash(size: Long, head: ByteArray, tail: ByteArray): String? {
        if (size < 2L * CHUNK || head.size != CHUNK || tail.size != CHUNK) return null
        var sum = size
        for (chunk in arrayOf(head, tail)) {
            val words = ByteBuffer.wrap(chunk).order(ByteOrder.LITTLE_ENDIAN)
            var at = 0
            while (at < CHUNK) {
                sum += words.getLong(at)
                at += 8
            }
        }
        return String.format("%016x", sum)
    }

    /** The file's size from a Content-Range such as "bytes 0-65535/123456", or null. */
    fun totalFrom(contentRange: String?): Long? {
        val match = TOTAL.find(contentRange ?: return null) ?: return null
        return match.groupValues[1].toLongOrNull()
    }

    /** A server too busy to answer now (408, 425, 429, 5xx), which says nothing of the link. */
    fun isBusy(status: Int): Boolean = status == 408 || status == 425 || status == 429 || status >= 500

    fun rangeHeader(start: Long): String = "bytes=$start-${start + CHUNK - 1}"
}

/** What the page asked to have read. The link is never printed: toString() leaves it out. */
data class HashRequest(val id: Int, val url: String, val size: Long?, val headers: Map<String, String>) {
    override fun toString(): String = "HashRequest(id=$id)"
}

sealed class HashResult {
    /** fellBack: "size" or "end", the first read the link it landed on refused. */
    data class Found(val hash: String, val size: Long, val walks: Int, val fellBack: String?) : HashResult()

    /**
     * why: "no range", "no size", "too small", "refused", "busy" or "timed out", the page's
     * words. step: "start", "size" or "end", the read it came at.
     */
    data class Failed(val why: String, val step: String, val walks: Int) : HashResult()

    /** A newer request took its place. Never sent. */
    object Cancelled : HashResult()
}

/** The hash event's fields, as the page reads them. Never the link, nor where it led. */
fun hashEventFields(id: Int, r: HashResult): Map<String, Any> =
    when (r) {
        is HashResult.Found -> {
            val fields = linkedMapOf<String, Any>("id" to id, "hash" to r.hash, "size" to r.size, "walks" to r.walks)
            if (r.fellBack != null) fields["fellBack"] = r.fellBack
            fields
        }
        is HashResult.Failed -> linkedMapOf("id" to id, "failed" to r.why, "step" to r.step, "walks" to r.walks)
        HashResult.Cancelled -> linkedMapOf("id" to id)
    }

/**
 * Reads one file's hash with two byte-range requests, on whatever thread calls read(): never the
 * main one. Redirects are followed by hand, so where a read landed is known and the later reads
 * go straight there. At most deadlineMs in all.
 */
class StreamHashReader(
    private val userAgent: String,
    private val connectMs: Int = 4000,
    private val readMs: Int = 4000,
    private val deadlineMs: Long = 12_000,
    private val now: () -> Long = { System.nanoTime() / 1_000_000 },
    private val open: (URL) -> HttpURLConnection = { it.openConnection() as HttpURLConnection },
) {
    /** One answer: what it found, and whether the host refused it (worth one more try). */
    private class Answer(
        val refused: Boolean,
        val busy: Boolean = false,
        val bytes: ByteArray? = null,
        val total: Long? = null,
        val length: Long? = null,
        val landed: String? = null,
    )

    private class Fail(val why: String, val step: String) : Exception() {
        override fun fillInStackTrace(): Throwable = this
    }

    /** Stopped before a request or while its bytes came: cancelled, or past the deadline. */
    private class Stop(val cancelled: Boolean) : Exception() {
        override fun fillInStackTrace(): Throwable = this
    }

    private inner class Run(val request: HashRequest, val cancelled: () -> Boolean) {
        val deadline = now() + deadlineMs
        var step = "start"
        var walks = 0
        var fellBack: String? = null

        fun read(): HashResult {
            walks++
            val first = fetch(this, request.url, 0L)
            if (first.refused) throw Fail(if (first.busy) "busy" else "refused", "start")
            val head = first.bytes ?: throw Fail("no range", "start")
            // Kept here only, for the later reads: never said, nor stored.
            var landed: String? = first.landed?.takeIf { it != request.url }

            // Every later read goes straight to where the first landed. A read there that is
            // refused goes once through the stream's own link, and so does every read after it.
            fun once(attempt: (String) -> Answer): Answer {
                val direct = landed
                if (direct != null && fellBack == null) {
                    val answer = attempt(direct)
                    if (!answer.refused) return answer
                    fellBack = if (step == "size") "size" else "end"
                    landed = null
                }
                walks++
                return attempt(request.url)
            }

            var size = request.size ?: first.total
            if (size == null) {
                step = "size"
                val sized = once { fetch(this, it, null) }
                size = sized.length
                if (size == null) {
                    throw Fail(if (sized.busy) "busy" else if (sized.refused) "refused" else "no size", "size")
                }
            }
            if (size < 2L * StreamHash.CHUNK) throw Fail("too small", step)
            step = "end"
            val end = size - StreamHash.CHUNK
            val last =
                once { target ->
                    val answer = fetch(this, target, end)
                    // An answer that names another size is not this file's end.
                    if (answer.bytes != null && answer.total != null && answer.total != size) {
                        Answer(refused = true)
                    } else {
                        answer
                    }
                }
            val tail = last.bytes
                ?: throw Fail(if (last.busy) "busy" else if (last.refused) "refused" else "no range", "end")
            val hash = StreamHash.hash(size, head, tail) ?: throw Fail("too small", "end")
            return HashResult.Found(hash, size, walks, fellBack)
        }

        /** Before every request, and between pieces of an answer: stopped when cancelled or late. */
        fun check() {
            if (cancelled()) throw Stop(cancelled = true)
            if (now() >= deadline) throw Stop(cancelled = false)
        }

        fun left(): Long = deadline - now()

        fun late(): Boolean = now() >= deadline
    }

    /** Reads the hash the request asks for. Never throws. */
    fun read(request: HashRequest, cancelled: () -> Boolean): HashResult {
        val run = Run(request, cancelled)
        return try {
            run.read()
        } catch (e: Fail) {
            HashResult.Failed(e.why, e.step, run.walks)
        } catch (e: Stop) {
            if (e.cancelled) HashResult.Cancelled else HashResult.Failed("timed out", run.step, run.walks)
        } catch (e: RuntimeException) {
            // Whatever it was, it says nothing that may be shown: a refusal, at the read it came at.
            HashResult.Failed("refused", run.step, run.walks)
        }
    }

    /**
     * One request, its redirects followed by hand: a range read of CHUNK bytes from rangeStart,
     * or with rangeStart null, a plain request stopped at its headers, for the size.
     */
    private fun fetch(run: Run, target: String, rangeStart: Long?): Answer {
        var current =
            try {
                URL(target)
            } catch (e: IOException) {
                return Answer(refused = true)
            }
        var hops = 0
        while (true) {
            run.check()
            if (current.protocol != "http" && current.protocol != "https") return Answer(refused = true)
            var connection: HttpURLConnection? = null
            try {
                val c = open(current)
                connection = c
                c.instanceFollowRedirects = false
                c.useCaches = false
                val left = run.left().coerceAtLeast(1L)
                c.connectTimeout = minOf(connectMs.toLong(), left).toInt().coerceAtLeast(1)
                c.readTimeout = minOf(readMs.toLong(), left).toInt().coerceAtLeast(1)
                c.requestMethod = "GET"
                c.setRequestProperty("User-Agent", Protocol.userAgent(run.request.headers) ?: userAgent)
                for ((name, value) in run.request.headers) {
                    if (name.equals("User-Agent", ignoreCase = true)) continue
                    if (name.equals("Accept-Encoding", ignoreCase = true)) continue
                    c.setRequestProperty(name, value)
                }
                // The bytes as they are on the server: a compressed answer is no part of the file.
                c.setRequestProperty("Accept-Encoding", "identity")
                if (rangeStart != null) c.setRequestProperty("Range", StreamHash.rangeHeader(rangeStart))

                val status = c.responseCode
                if (status in REDIRECTS) {
                    val location = c.getHeaderField("Location")
                    hops++
                    if (location == null || hops > MAX_REDIRECTS) return Answer(refused = true)
                    current = URL(current, location)
                    continue
                }
                val landed = current.toString()
                if (rangeStart != null && status == 206) {
                    val bytes = readChunk(run, c.inputStream)
                    return Answer(
                        refused = false,
                        bytes = bytes,
                        total = StreamHash.totalFrom(c.getHeaderField("Content-Range")),
                        landed = landed,
                    )
                }
                // A server that ignores the range sends the whole file: stop at the headers.
                val ok = status in 200..299
                val length = c.getHeaderField("Content-Length")?.trim()?.toLongOrNull()
                return Answer(
                    refused = !ok,
                    busy = StreamHash.isBusy(status),
                    total = StreamHash.totalFrom(c.getHeaderField("Content-Range")),
                    length = if (ok && rangeStart == null && length != null && length > 0) length else null,
                    landed = landed,
                )
            } catch (e: IOException) {
                // Past the deadline, that is the timeout, not a refusal.
                if (run.late()) throw Stop(cancelled = false)
                return Answer(refused = true)
            } finally {
                connection?.disconnect()
            }
        }
    }

    /**
     * Exactly CHUNK bytes, or null for fewer or more. A host that sends them slowly is given up on
     * at the deadline, or as soon as a newer request cancels the read, between one piece and the
     * next: the read timeout bounds each piece only.
     */
    private fun readChunk(run: Run, input: InputStream): ByteArray? {
        val buffer = ByteArray(StreamHash.CHUNK + 1)
        var filled = 0
        input.use {
            while (filled < buffer.size) {
                val n = it.read(buffer, filled, buffer.size - filled)
                if (n < 0) break
                filled += n
                if (filled < buffer.size) run.check()
            }
        }
        return if (filled == StreamHash.CHUNK) buffer.copyOf(StreamHash.CHUNK) else null
    }

    private companion object {
        val REDIRECTS = setOf(301, 302, 303, 307, 308)
        const val MAX_REDIRECTS = 5
    }
}
