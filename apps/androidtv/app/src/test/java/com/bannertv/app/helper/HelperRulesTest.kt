package com.bannertv.app.helper

import java.net.InetAddress
import java.net.URI
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HelperRulesTest {
    private fun ip(text: String): InetAddress = InetAddress.getByName(text)

    @Test
    fun answersOnlyTheHomeNetwork() {
        for (home in listOf("192.168.1.20", "10.0.0.5", "172.16.3.4", "127.0.0.1", "fe80::1", "fd12::5")) {
            assertTrue(home, AddressRules.isHomeClient(ip(home)))
        }
        for (away in listOf("8.8.8.8", "2001:4860::8888", "100.64.0.1")) {
            assertFalse(away, AddressRules.isHomeClient(ip(away)))
        }
    }

    @Test
    fun fetchesOnlyPublicAddresses() {
        for (public in listOf("8.8.8.8", "151.101.1.1", "2606:4700::1111", "64:ff9b::808:808")) {
            assertTrue(public, AddressRules.isPublicTarget(ip(public)))
        }
        val refused = listOf(
            "192.168.1.1", "10.1.2.3", "172.31.0.1", "127.0.0.1", "0.0.0.0", "169.254.169.254",
            "100.100.1.1", "224.0.0.1", "255.255.255.255", "::1", "fe80::1", "fc00::1",
            "::ffff:192.168.1.1", "64:ff9b::c0a8:101",
        )
        for (address in refused) assertFalse(address, AddressRules.isPublicTarget(ip(address)))
    }

    @Test
    fun picksTheWiFiAddressTheTvCanReach() {
        val found = AddressRules.homeAddress(
            listOf(
                "rmnet0" to ip("10.200.1.2"),
                "wlan0" to ip("fe80::1"),
                "wlan0" to ip("192.168.1.42"),
                "tun0" to ip("8.8.4.4"),
            ),
        )
        assertEquals(ip("192.168.1.42"), found)
        assertEquals(ip("10.200.1.2"), AddressRules.homeAddress(listOf("rmnet0" to ip("10.200.1.2"))))
        assertNull(AddressRules.homeAddress(listOf("rmnet0" to ip("100.70.1.2"))))
    }

    @Test
    fun base64UrlRoundTrips() {
        for (size in 0..20) {
            val bytes = ByteArray(size) { (it * 37 + 250).toByte() }
            val text = Base64Url.encode(bytes)
            assertTrue(text.none { it == '+' || it == '/' || it == '=' })
            assertArrayEquals(bytes, Base64Url.decode(text))
        }
        assertEquals("aGk", Base64Url.encode("hi".toByteArray()))
        assertNull(Base64Url.decode("a"))
        assertNull(Base64Url.decode("a+b/"))
        assertNull(Base64Url.decode("aGl")) // leftover bits not zero
    }

    @Test
    fun linksLapseWhenIdleAndStayCapped() {
        var now = 0L
        val links = StreamLinks(now = { now }, idleMs = 1000, max = 2)
        val target = URI("https://cdn.example/live.m3u8")
        val first = links.add(target, mapOf("Referer" to "https://site.example/"))
        assertEquals(22, first.length)
        now = 900
        assertNotNull(links.use(first))
        now = 1800
        assertNotNull("use keeps it alive", links.use(first))
        now = 2900
        assertNull(links.use(first))
        val a = links.add(target, emptyMap())
        val b = links.add(target, emptyMap())
        val c = links.add(target, emptyMap())
        assertNull("the oldest goes past the limit", links.use(a))
        assertNotNull(links.use(b))
        assertNotNull(links.use(c))
    }

    @Test
    fun pairingHandsOutKeysForTheRightCodeOnly() {
        var saved: Set<String> = emptySet()
        val pairing = Pairing(emptySet()) { saved = it }
        val code = pairing.code
        assertEquals(6, code.length)
        assertNull(pairing.pair("not it"))
        val key = pairing.pair(code)
        assertNotNull(key)
        assertTrue(pairing.isPaired(key))
        assertEquals(setOf(key), saved)
        assertFalse("a used code changes", pairing.code == code && pairing.pair(code) != null)
        assertFalse(pairing.isPaired("other"))
        assertFalse(pairing.isPaired(null))

        val again = Pairing(saved) {}
        assertTrue("keys handed out before still work", again.isPaired(key))
        again.forgetAll()
        assertFalse(again.isPaired(key))
    }

    @Test
    fun pairingChangesTheCodeAfterWrongGuesses() {
        val pairing = Pairing(emptySet()) {}
        val code = pairing.code
        val wrong = if (code == "000000") "000001" else "000000"
        repeat(Pairing.MAX_FAILURES) { pairing.pair(wrong) }
        // One in a million the new code repeats the old one.
        if (pairing.code != code) assertNull(pairing.pair(code))
    }

    @Test
    fun rewritesEveryAddressAPlaylistNames() {
        val base = URI("https://cdn.example/live/master.m3u8?t=1")
        val playlist =
            """
            #EXTM3U
            #EXT-X-KEY:METHOD=AES-128,URI="keys/k1.bin",IV=0x1
            #EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://drm"
            #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="audio/en.m3u8"
            #EXT-X-MAP:URI="/init.mp4"
            #EXT-X-STREAM-INF:BANDWIDTH=800000
            low/index.m3u8
            # a comment
            https://other.example/seg1.ts

            """.trimIndent().replace("\n", "\r\n")
        val out = Playlist.rewrite(playlist, base) { "[${it}]" }
        val lines = out.lines()
        assertEquals("#EXTM3U", lines[0])
        assertEquals("#EXT-X-KEY:METHOD=AES-128,URI=\"[https://cdn.example/live/keys/k1.bin]\",IV=0x1", lines[1])
        assertEquals("#EXT-X-KEY:METHOD=SAMPLE-AES,URI=\"skd://drm\"", lines[2])
        assertEquals(
            "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"a\",URI=\"[https://cdn.example/live/audio/en.m3u8]\"",
            lines[3],
        )
        assertEquals("#EXT-X-MAP:URI=\"[https://cdn.example/init.mp4]\"", lines[4])
        assertEquals("[https://cdn.example/live/low/index.m3u8]", lines[6])
        assertEquals("# a comment", lines[7])
        assertEquals("[https://other.example/seg1.ts]", lines[8])
        assertFalse(out.contains('\r'))
    }

    @Test
    fun knowsAPlaylistByTypeOrName() {
        assertTrue(Playlist.isPlaylist("application/vnd.apple.mpegurl; charset=utf-8", URI("https://a.example/x")))
        assertTrue(Playlist.isPlaylist(null, URI("https://a.example/live/INDEX.M3U8")))
        assertFalse(Playlist.isPlaylist("video/mp2t", URI("https://a.example/seg.ts")))
    }
}
