package com.bannertv.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CuesTest {
    @Test
    fun aCueWithNoLineIsAtTheBottom() {
        assertFalse(Cues.atTop(Cues.DIMEN_UNSET, Cues.LINE_TYPE_NUMBER))
        assertFalse(Cues.atTop(Cues.DIMEN_UNSET, Cues.LINE_TYPE_FRACTION))
        assertFalse(Cues.atTop(Float.NaN, Cues.LINE_TYPE_FRACTION))
    }

    @Test
    fun theFirstLinesAndTheTopOfThePictureAreAtTheTop() {
        // WebVTT line:0 and SSA \an8 (Media3 places it at a small fraction).
        assertTrue(Cues.atTop(0f, Cues.LINE_TYPE_NUMBER))
        assertTrue(Cues.atTop(3f, Cues.LINE_TYPE_NUMBER))
        assertTrue(Cues.atTop(0.05f, Cues.LINE_TYPE_FRACTION))
        // Lines counted from the bottom, the middle and the bottom of the picture.
        assertFalse(Cues.atTop(-1f, Cues.LINE_TYPE_NUMBER))
        assertFalse(Cues.atTop(4f, Cues.LINE_TYPE_NUMBER))
        assertFalse(Cues.atTop(0.5f, Cues.LINE_TYPE_FRACTION))
        assertFalse(Cues.atTop(0.95f, Cues.LINE_TYPE_FRACTION))
        // Cue.TYPE_UNSET.
        assertFalse(Cues.atTop(0f, Int.MIN_VALUE))
    }

    @Test
    fun plainTextIsEscapedSoItNeverReadsAsATag() {
        assertEquals("Tom &amp; Jerry &lt;3 &gt;", Cues.markup("Tom & Jerry <3 >", emptyList()))
        assertEquals("&lt;i&gt;not a tag&lt;/i&gt;", Cues.markup("<i>not a tag</i>", emptyList()))
        assertEquals("", Cues.markup("", emptyList()))
    }

    @Test
    fun styledRunsBecomeTags() {
        val italic = Cues.Run(0, 5, bold = false, italic = true, underline = false)
        assertEquals("<i>Hello</i> there", Cues.markup("Hello there", listOf(italic)))
        val bold = Cues.Run(6, 11, bold = true, italic = false, underline = false)
        assertEquals("<i>Hello</i> <b>there</b>", Cues.markup("Hello there", listOf(italic, bold)))
        val underline = Cues.Run(0, 2, bold = false, italic = false, underline = true)
        assertEquals("<u>Hi</u>", Cues.markup("Hi", listOf(underline)))
    }

    @Test
    fun overlappingRunsNestInOneOrder() {
        val bold = Cues.Run(0, 4, bold = true, italic = false, underline = false)
        val italic = Cues.Run(2, 6, bold = false, italic = true, underline = false)
        assertEquals("<b>ab</b><b><i>cd</i></b><i>ef</i>", Cues.markup("abcdef", listOf(bold, italic)))
    }

    @Test
    fun lineBreaksStayInsideARun() {
        val italic = Cues.Run(0, 11, bold = false, italic = true, underline = false)
        assertEquals("<i>Hello\nthere</i>", Cues.markup("Hello\nthere", listOf(italic)))
    }

    @Test
    fun runsPastTheEndOfTheTextAreHarmless() {
        val italic = Cues.Run(3, 40, bold = false, italic = true, underline = false)
        assertEquals("abc<i>d</i>", Cues.markup("abcd", listOf(italic)))
    }

    @Test
    fun cueTimesAreOnThePagesClock() {
        assertEquals(12.5, Cues.seconds(12_500_000L, 0L, 0L), 0.0)
        // A live HLS window starts some way into its period.
        assertEquals(2.0, Cues.seconds(3_602_000_000L, 3_600_000_000L, 0L), 0.0)
        assertEquals(0.0, Cues.seconds(1_000_000L, 2_000_000L, 0L), 0.0)
        assertEquals(1.0, Cues.seconds(1_000_000L, Cues.TIME_UNSET, 0L), 0.0)
        // No time on the group: where the player is.
        assertEquals(4.25, Cues.seconds(Cues.TIME_UNSET, 0L, 4_250L), 0.0)
        assertEquals(0.0, Cues.seconds(Cues.TIME_UNSET, 0L, -5L), 0.0)
    }
}
