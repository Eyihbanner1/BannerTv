package com.bannertv.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RemoteKeysTest {
    @Test
    fun mapsMediaKeysToProtocolNames() {
        assertEquals("MediaPlayPause", RemoteKeys.nameFor(85))
        assertEquals("MediaPlayPause", RemoteKeys.nameFor(79))
        assertEquals("MediaPlay", RemoteKeys.nameFor(126))
        assertEquals("MediaPause", RemoteKeys.nameFor(127))
        assertEquals("MediaStop", RemoteKeys.nameFor(86))
        assertEquals("MediaFastForward", RemoteKeys.nameFor(90))
        assertEquals("MediaRewind", RemoteKeys.nameFor(89))
    }

    @Test
    fun mapsColourKeys() {
        assertEquals("Red", RemoteKeys.nameFor(183))
        assertEquals("Green", RemoteKeys.nameFor(184))
        assertEquals("Yellow", RemoteKeys.nameFor(185))
        assertEquals("Blue", RemoteKeys.nameFor(186))
    }

    @Test
    fun leavesNavigationKeysToTheWebView() {
        // Back (4) arrives through OnBackPressedDispatcher; D-pad, centre, Enter and digits reach the page.
        for (keyCode in listOf(4, 19, 20, 21, 22, 23, 66, 7, 16, 82, 0)) {
            assertNull("key code $keyCode", RemoteKeys.nameFor(keyCode))
        }
    }
}
