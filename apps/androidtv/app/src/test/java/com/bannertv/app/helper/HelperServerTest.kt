package com.bannertv.app.helper

import com.sun.net.httpserver.HttpServer
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.URI
import java.net.URL
import java.net.URLEncoder
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** The helper end to end, against a stand-in add-on server on this machine. */
class HelperServerTest {
    private lateinit var upstream: HttpServer
    private lateinit var helper: HelperServer
    private lateinit var pairing: Pairing
    private val seen = mutableListOf<Map<String, String?>>()
    private var allowLoopbackTargets = true

    private val upstreamBase get() = "http://127.0.0.1:${upstream.address.port}"
    private val helperBase get() = "http://127.0.0.1:${helper.port}"

    @Before
    fun setUp() {
        upstream = HttpServer.create(InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0)
        upstream.createContext("/") { exchange ->
            seen.add(
                mapOf(
                    "path" to exchange.requestURI.path,
                    "referer" to exchange.requestHeaders.getFirst("Referer"),
                    "ua" to exchange.requestHeaders.getFirst("User-Agent"),
                    "range" to exchange.requestHeaders.getFirst("Range"),
                ),
            )
            when (exchange.requestURI.path) {
                "/live/master.m3u8" -> {
                    val body = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow.m3u8\n".toByteArray()
                    exchange.responseHeaders.add("Content-Type", "application/vnd.apple.mpegurl")
                    exchange.sendResponseHeaders(200, body.size.toLong())
                    exchange.responseBody.use { it.write(body) }
                }
                "/hop" -> {
                    exchange.responseHeaders.add("Location", "/video.mp4")
                    exchange.sendResponseHeaders(302, -1)
                    exchange.close()
                }
                "/video.mp4" -> {
                    val body = "0123456789".toByteArray()
                    exchange.responseHeaders.add("Content-Type", "video/mp4")
                    exchange.responseHeaders.add("Content-Range", "bytes 2-5/10")
                    exchange.sendResponseHeaders(206, 4)
                    exchange.responseBody.use { it.write(body, 2, 4) }
                }
                else -> {
                    exchange.sendResponseHeaders(404, -1)
                    exchange.close()
                }
            }
        }
        upstream.start()
        pairing = Pairing(emptySet()) {}
        helper =
            HelperServer(
                links = StreamLinks(),
                pairing = pairing,
                userAgent = "BannerTV/test",
                allowTarget = { allowLoopbackTargets || AddressRules.isPublicTarget(it) },
            )
        helper.start(preferredPort = 0)
    }

    @After
    fun tearDown() {
        helper.stop()
        upstream.stop(0)
    }

    private fun call(
        method: String,
        path: String,
        form: Map<String, String>? = null,
        headers: Map<String, String> = emptyMap(),
    ): Triple<Int, Map<String, String>, String> {
        val connection = URL(helperBase + path).openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.instanceFollowRedirects = false
        for ((name, value) in headers) connection.setRequestProperty(name, value)
        if (form != null) {
            connection.doOutput = true
            val body = form.entries.joinToString("&") {
                URLEncoder.encode(it.key, "UTF-8") + "=" + URLEncoder.encode(it.value, "UTF-8")
            }
            connection.outputStream.use { it.write(body.toByteArray()) }
        }
        val status = connection.responseCode
        val stream = if (status >= 400) connection.errorStream else connection.inputStream
        val text = stream?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
        val heads = connection.headerFields.filterKeys { it != null }.mapValues { it.value.first() }
        return Triple(status, heads, text)
    }

    private fun pairAndLink(url: String, headers: Map<String, String>): String {
        val (_, _, keyJson) = call("POST", "/pair", mapOf("code" to pairing.code))
        val key = keyJson.substringAfter("\"key\":\"").substringBefore('"')
        val form = mapOf("url" to url) + headers.mapKeys { "h.${it.key}" }
        val (status, _, linkJson) = call("POST", "/links", form, mapOf("Authorization" to "Bearer $key"))
        assertEquals(200, status)
        return linkJson.substringAfter("\"link\":\"").substringBefore('"')
    }

    @Test
    fun saysWhoItIs() {
        val (status, headers, body) = call("GET", "/status")
        assertEquals(200, status)
        assertTrue(body.contains("\"helper\":\"bannertv\""))
        assertEquals("*", headers["Access-Control-Allow-Origin"])
    }

    @Test
    fun refusesLinksWithoutPairing() {
        val (status, _, _) = call("POST", "/links", mapOf("url" to "$upstreamBase/video.mp4"))
        assertEquals(401, status)
        val (wrong, _, _) = call("POST", "/pair", mapOf("code" to "x"))
        assertEquals(403, wrong)
    }

    @Test
    fun forgetsATvThatUnpairs() {
        val (_, _, keyJson) = call("POST", "/pair", mapOf("code" to pairing.code))
        val key = keyJson.substringAfter("\"key\":\"").substringBefore('"')
        val auth = mapOf("Authorization" to "Bearer $key")
        assertEquals(1, pairing.pairedCount())

        val (forgot, _, _) = call("POST", "/forget", emptyMap(), auth)
        assertEquals(204, forgot)
        assertEquals(0, pairing.pairedCount())

        val (again, _, _) = call("POST", "/forget", emptyMap(), auth)
        assertEquals(401, again)
        val (link, _, _) = call("POST", "/links", mapOf("url" to "$upstreamBase/video.mp4"), auth)
        assertEquals(401, link)
    }

    @Test
    fun sendsTheHeadersAndPointsThePlaylistBackAtItself() {
        val link = pairAndLink(
            "$upstreamBase/live/master.m3u8",
            mapOf("Referer" to "https://site.example/", "User-Agent" to "AddonAgent", "Host" to "evil"),
        )
        assertTrue(link.endsWith("/master.m3u8"))
        val (status, headers, body) = call("GET", link)
        assertEquals(200, status)
        assertEquals("application/vnd.apple.mpegurl", headers["Content-Type"])
        val variant = body.lines()[2]
        assertTrue(variant, variant.startsWith("/s/") && variant.endsWith("/low.m3u8"))
        assertEquals("https://site.example/", seen.last()["referer"])
        assertEquals("AddonAgent", seen.last()["ua"])

        // The variant goes through the helper with the same headers.
        call("GET", variant)
        assertEquals("/live/low.m3u8", seen.last()["path"])
        assertEquals("https://site.example/", seen.last()["referer"])
    }

    @Test
    fun followsRedirectsAndPassesSeekingThrough() {
        val link = pairAndLink("$upstreamBase/hop", emptyMap())
        val (status, headers, body) = call("GET", link, headers = mapOf("Range" to "bytes=2-5"))
        assertEquals(206, status)
        assertEquals("bytes 2-5/10", headers["Content-Range"])
        assertEquals("2345", body)
        assertEquals("bytes=2-5", seen.last()["range"])
        assertEquals("BannerTV/test", seen.last()["ua"])
    }

    @Test
    fun neverFetchesFromTheHomeNetwork() {
        allowLoopbackTargets = false
        val link = pairAndLink("$upstreamBase/video.mp4", emptyMap())
        val (status, _, _) = call("GET", link)
        assertEquals(502, status)
        assertTrue(seen.isEmpty())
    }

    @Test
    fun refusesUnknownTokensAndForeignAddresses() {
        val link = pairAndLink("$upstreamBase/video.mp4", emptyMap())
        val token = link.split('/')[2]
        val address = Base64Url.encode("$upstreamBase/video.mp4".toByteArray())
        assertEquals(404, call("GET", "/s/nottoken/$address/x").first)
        assertEquals(400, call("GET", "/s/$token/!!!/x").first)
        assertEquals(400, call("GET", "/s/$token/${Base64Url.encode("file:///etc/passwd".toByteArray())}/x").first)
        assertFalse(seen.any { it["path"] == "/etc/passwd" })
    }

    @Test
    fun linkPathKeepsASafeFileName() {
        val path = HelperServer.linkPath("tok", URI("https://a.example/a/b/ev%20il%3C%3E.m3u8?x=1"))
        assertTrue(path, path.startsWith("/s/tok/") && path.endsWith("/ev20il3C3E.m3u8"))
        assertTrue(HelperServer.linkPath("tok", URI("https://a.example/")).endsWith("/media"))
    }
}
