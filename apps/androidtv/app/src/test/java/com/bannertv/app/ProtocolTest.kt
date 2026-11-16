package com.bannertv.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtocolTest {
    @Test
    fun startUrlIsTheFixedOrigin() {
        // Changing this loses every user's local data, so a change must fail a test first.
        assertEquals("https://appassets.androidplatform.net/assets/web/index.html", Protocol.START_URL)
        assertEquals("1", Protocol.VERSION)
        assertEquals("BannerAndroid", Protocol.BRIDGE_NAME)
    }

    @Test
    fun eventScriptGuardsAndEscapesLineSeparators() {
        assertEquals(
            "window.__bannerAndroid&&window.__bannerAndroid.event({\"type\":\"relaunch\"})",
            Protocol.eventScript("{\"type\":\"relaunch\"}"),
        )
        val script = Protocol.eventScript("{\"label\":\"a b c\"}")
        assertFalse(script.contains(" "))
        assertFalse(script.contains(" "))
        assertTrue(script.contains("a\\u2028b\\u2029c"))
    }

    @Test
    fun onlyTheAppOriginIsNavigable() {
        assertTrue(Protocol.isAppUrl("https://appassets.androidplatform.net/assets/web/index.html#/home"))
        assertFalse(Protocol.isAppUrl("https://appassets.androidplatform.net.evil.example/"))
        assertFalse(Protocol.isAppUrl("http://appassets.androidplatform.net/assets/web/index.html"))
        assertFalse(Protocol.isAppUrl("https://www.youtube.com/watch?v=abc"))
    }

    @Test
    fun externalUrlsMustBeHttps() {
        assertTrue(Protocol.isExternalUrlAllowed("https://www.youtube.com/watch?v=dQw4w9WgXcQ"))
        assertTrue(Protocol.isExternalUrlAllowed("HTTPS://example.com"))
        assertFalse(Protocol.isExternalUrlAllowed("http://www.youtube.com/watch?v=abc"))
        assertFalse(Protocol.isExternalUrlAllowed("intent://scan/#Intent;scheme=zxing;end"))
        assertFalse(Protocol.isExternalUrlAllowed("javascript:alert(1)"))
        assertFalse(Protocol.isExternalUrlAllowed("https://"))
        assertFalse(Protocol.isExternalUrlAllowed(""))
        assertFalse(Protocol.isExternalUrlAllowed(null))
    }

    @Test
    fun readsTheWebViewMajorVersion() {
        assertEquals(138, Protocol.webViewMajor("138.0.7204.244"))
        assertEquals(67, Protocol.webViewMajor("67.0.3396.87"))
        assertNull(Protocol.webViewMajor("unknown"))
        assertNull(Protocol.webViewMajor(null))
    }

    @Test
    fun parsesTrackIds() {
        assertEquals(Pair(2, 0), Protocol.parseTrackId("2:0"))
        assertEquals("3:1", Protocol.trackId(3, 1))
        assertNull(Protocol.parseTrackId("2"))
        assertNull(Protocol.parseTrackId("-1:0"))
        assertNull(Protocol.parseTrackId("a:b"))
        assertNull(Protocol.parseTrackId(null))
    }

    @Test
    fun recognisesStreamTypes() {
        assertEquals(Protocol.STREAM_HLS, Protocol.streamType("application/vnd.apple.mpegurl"))
        assertEquals(Protocol.STREAM_HLS, Protocol.streamType("application/x-mpegURL"))
        assertEquals(Protocol.STREAM_DASH, Protocol.streamType("application/dash+xml"))
        assertNull(Protocol.streamType("video/x-matroska"))
        assertNull(Protocol.streamType(""))
        assertNull(Protocol.streamType(null))
    }

    // The rules themselves are tested in HeaderRulesTest: the player keeps the stream helper's.
    @Test
    fun keepsOnlyRequestHeadersThatCanBeSent() {
        val sent =
            Protocol.requestHeaders(
                mapOf(
                    "Referer" to "https://site.example/",
                    "User-Agent" to "Mozilla/5.0 (X11)",
                    "Bad Name" to "x",
                    "X-Split" to "a\r\nInjected: yes",
                    "Range" to "bytes=0-",
                    "host" to "other.example",
                    "X-Empty" to null,
                ),
            )
        assertEquals(mapOf("Referer" to "https://site.example/", "User-Agent" to "Mozilla/5.0 (X11)"), sent)
        assertTrue(Protocol.requestHeaders(emptyMap()).isEmpty())
    }

    @Test
    fun findsTheUserAgentWhateverItsCase() {
        assertEquals("Agent/1", Protocol.userAgent(mapOf("user-agent" to "Agent/1")))
        assertNull(Protocol.userAgent(mapOf("Referer" to "https://site.example/")))
    }

    @Test
    fun aHashIsReadOnlyFromAnHttpLink() {
        assertTrue(Protocol.isHashUrl("http://cdn.example/file.mkv"))
        assertTrue(Protocol.isHashUrl("HTTPS://cdn.example/file.mkv?token=a"))
        assertTrue(Protocol.isHashUrl("  https://cdn.example/file.mkv  "))
        assertFalse(Protocol.isHashUrl("ftp://cdn.example/file.mkv"))
        assertFalse(Protocol.isHashUrl("magnet:?xt=urn:btih:abc"))
        assertFalse(Protocol.isHashUrl("https://"))
        assertFalse(Protocol.isHashUrl("   "))
        assertFalse(Protocol.isHashUrl(""))
        assertFalse(Protocol.isHashUrl(null))
        assertFalse(Protocol.isHashUrl("https://cdn.example/a file.mkv"))
    }

    @Test
    fun aHashRequestNeedsAnIdAndALink() {
        assertNull(Protocol.hashRequest(0, "https://cdn.example/file.mkv", 1000, emptyMap()))
        assertNull(Protocol.hashRequest(-3, "https://cdn.example/file.mkv", 1000, emptyMap()))
        assertNull(Protocol.hashRequest(1, "ftp://cdn.example/file.mkv", 1000, emptyMap()))
        assertNull(Protocol.hashRequest(1, null, 1000, emptyMap()))

        val known = Protocol.hashRequest(4, "https://cdn.example/file.mkv", 1_000_000, emptyMap())!!
        assertEquals(4, known.id)
        assertEquals("https://cdn.example/file.mkv", known.url)
        assertEquals(1_000_000L, known.size)
        assertNull(Protocol.hashRequest(4, "https://cdn.example/file.mkv", 0, emptyMap())!!.size)
        assertNull(Protocol.hashRequest(4, "https://cdn.example/file.mkv", -1, emptyMap())!!.size)
    }

    @Test
    fun aHashRequestSendsOnlyHeadersThatCanBeSent() {
        val request =
            Protocol.hashRequest(
                2,
                "https://cdn.example/file.mkv",
                0,
                mapOf(
                    "Referer" to "https://site.example/",
                    "Range" to "bytes=0-",
                    "Bad Name" to "x",
                    "X-Empty" to null,
                ),
            )!!
        assertEquals(mapOf("Referer" to "https://site.example/"), request.headers)
        // The link never shows when the request is printed.
        assertEquals("HashRequest(id=2)", request.toString())
    }

    @Test
    fun undeterminedLanguageIsEmpty() {
        assertEquals("", Protocol.language(null))
        assertEquals("", Protocol.language("und"))
        assertEquals("en", Protocol.language("en"))
    }
}
