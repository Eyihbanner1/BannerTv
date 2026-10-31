package com.bannertv.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayerErrorsTest {
    @Test
    fun ioErrorsAreNetwork() {
        for (code in listOf(2000, 2001, 2002, 2004, 2005, 2008, 2999)) {
            assertEquals("code $code", PlayerErrors.NETWORK, PlayerErrors.kind(code))
        }
    }

    @Test
    fun parsingErrorsSplitBetweenDecodeAndFormat() {
        assertEquals(PlayerErrors.DECODE, PlayerErrors.kind(3001))
        assertEquals(PlayerErrors.DECODE, PlayerErrors.kind(3002))
        assertEquals(PlayerErrors.FORMAT, PlayerErrors.kind(3003))
        assertEquals(PlayerErrors.FORMAT, PlayerErrors.kind(3004))
    }

    @Test
    fun decoderErrorsSplitBetweenDecodeAndFormat() {
        assertEquals(PlayerErrors.DECODE, PlayerErrors.kind(4001))
        assertEquals(PlayerErrors.DECODE, PlayerErrors.kind(4002))
        assertEquals(PlayerErrors.DECODE, PlayerErrors.kind(4003))
        assertEquals(PlayerErrors.FORMAT, PlayerErrors.kind(4004))
        assertEquals(PlayerErrors.FORMAT, PlayerErrors.kind(4005))
    }

    @Test
    fun audioTrackAndDrmErrorsAreFormat() {
        assertEquals(PlayerErrors.FORMAT, PlayerErrors.kind(5001))
        assertEquals(PlayerErrors.FORMAT, PlayerErrors.kind(5002))
        assertEquals(PlayerErrors.FORMAT, PlayerErrors.kind(6000))
        assertEquals(PlayerErrors.FORMAT, PlayerErrors.kind(6006))
    }

    @Test
    fun everythingElseIsOther() {
        for (code in listOf(1000, 1001, 1003, 1004, 3000, 4000, 4006, 5000, 5003, 7000, -1)) {
            assertEquals("code $code", PlayerErrors.OTHER, PlayerErrors.kind(code))
        }
    }

    @Test
    fun onlyBehindLiveWindowRecoversNatively() {
        assertTrue(PlayerErrors.recoversNatively(1002))
        assertFalse(PlayerErrors.recoversNatively(1000))
        assertFalse(PlayerErrors.recoversNatively(2004))
    }

    @Test
    fun detailNamesTheCode() {
        assertEquals(
            "ERROR_CODE_IO_BAD_HTTP_STATUS (2004)",
            PlayerErrors.detail("ERROR_CODE_IO_BAD_HTTP_STATUS", 2004),
        )
    }

    @Test
    fun messagesNeverNeedTheUrl() {
        assertEquals("The server refused the stream (HTTP 404).", PlayerErrors.message(PlayerErrors.NETWORK, 404))
        for (kind in listOf(PlayerErrors.NETWORK, PlayerErrors.DECODE, PlayerErrors.FORMAT, PlayerErrors.OTHER)) {
            val message = PlayerErrors.message(kind, null)
            assertFalse(message, message.contains("://"))
        }
    }
}
