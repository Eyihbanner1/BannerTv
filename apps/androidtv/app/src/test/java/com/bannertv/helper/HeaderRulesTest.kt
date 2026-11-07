package com.bannertv.helper

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HeaderRulesTest {
    @Test
    fun keepsOnlyRequestHeadersThatCanBeSent() {
        val sent =
            HeaderRules.requestHeaders(
                mapOf(
                    "Referer" to "https://site.example/",
                    "User-Agent" to "Mozilla/5.0 (X11)",
                    "Bad Name" to "x",
                    "X-Split" to "a\r\nInjected: yes",
                    "X-Nul" to "a\u0000b",
                    "Range" to "bytes=0-",
                    "host" to "other.example",
                    "Transfer-Encoding" to "chunked",
                    "X-Empty" to null,
                ),
            )
        assertEquals(mapOf("Referer" to "https://site.example/", "User-Agent" to "Mozilla/5.0 (X11)"), sent)
        assertTrue(HeaderRules.requestHeaders(emptyMap()).isEmpty())
    }

    @Test
    fun findsTheUserAgentWhateverItsCase() {
        assertEquals("Agent/1", HeaderRules.userAgent(mapOf("user-agent" to "Agent/1")))
        assertNull(HeaderRules.userAgent(mapOf("Referer" to "https://site.example/")))
    }
}
