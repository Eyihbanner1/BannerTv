package expo.modules.bannercues

/**
 * Pure helpers for handing the subtitles inside a file to the page, which draws them in the
 * viewer's subtitle style (ADR 0005, decision 6). The same as the Android TV app's Cues.kt
 * (apps/androidtv, where JUnit tests cover it), so both apps hand over the same lines. Media3's
 * constants are written out, so this needs nothing from Android.
 */
object Cues {
  /** Cue.DIMEN_UNSET: the cue has no line of its own. */
  val DIMEN_UNSET: Float = -Float.MAX_VALUE

  /** Cue.LINE_TYPE_FRACTION: `line` is a share of the picture's height. */
  const val LINE_TYPE_FRACTION: Int = 0

  /** Cue.LINE_TYPE_NUMBER: `line` counts lines, from the top when 0 or more. */
  const val LINE_TYPE_NUMBER: Int = 1

  /** C.TIME_UNSET. */
  val TIME_UNSET: Long = Long.MIN_VALUE + 1

  /** A cue placed above this share of the picture is drawn at the top, as hls.ts reads VTT. */
  private const val TOP_FRACTION = 0.3f

  /** A cue on one of the first four lines is drawn at the top. */
  private const val TOP_LINES = 4f

  private const val BOLD = 1
  private const val ITALIC = 2
  private const val UNDERLINE = 4

  /** A stretch of a cue's text in bold, italic or underline: characters [start, end). */
  data class Run(
    val start: Int,
    val end: Int,
    val bold: Boolean,
    val italic: Boolean,
    val underline: Boolean,
  )

  /** Whether a cue placed at `line` (Cue.line and Cue.lineType) belongs at the top of the picture. */
  fun atTop(line: Float, lineType: Int): Boolean {
    if (line == DIMEN_UNSET || line.isNaN()) return false
    return when (lineType) {
      LINE_TYPE_FRACTION -> line >= 0f && line < TOP_FRACTION
      LINE_TYPE_NUMBER -> line >= 0f && line < TOP_LINES
      else -> false
    }
  }

  /**
   * A cue's text as the markup the page reads (core's parseCueMarkup): `<b>`, `<i>` and `<u>`
   * around the styled runs, `&`, `<` and `>` escaped so the text never reads as a tag. Line
   * breaks stay as they are.
   */
  fun markup(text: String, runs: List<Run>): String {
    val out = StringBuilder()
    var at = 0
    while (at < text.length) {
      val style = styleAt(runs, at)
      var end = at + 1
      while (end < text.length && styleAt(runs, end) == style) end++
      if ((style and BOLD) != 0) out.append("<b>")
      if ((style and ITALIC) != 0) out.append("<i>")
      if ((style and UNDERLINE) != 0) out.append("<u>")
      for (index in at until end) {
        when (val char = text[index]) {
          '&' -> out.append("&amp;")
          '<' -> out.append("&lt;")
          '>' -> out.append("&gt;")
          else -> out.append(char)
        }
      }
      if ((style and UNDERLINE) != 0) out.append("</u>")
      if ((style and ITALIC) != 0) out.append("</i>")
      if ((style and BOLD) != 0) out.append("</b>")
      at = end
    }
    return out.toString()
  }

  /**
   * A cue group's time on the page's clock, in seconds. Media3 times cues from the start of the
   * period; the page's clock (expo-video's currentTime, Media3's currentPosition) counts from the
   * start of the window, which for a live HLS stream starts later. With no time, the player's
   * position stands in.
   */
  fun seconds(presentationTimeUs: Long, windowStartUs: Long, positionMs: Long): Double {
    if (presentationTimeUs == TIME_UNSET) return positionMs.coerceAtLeast(0L) / 1000.0
    val start = if (windowStartUs == TIME_UNSET) 0L else windowStartUs
    return (presentationTimeUs - start).coerceAtLeast(0L) / 1_000_000.0
  }

  private fun styleAt(runs: List<Run>, index: Int): Int {
    var style = 0
    for (run in runs) {
      if (index < run.start || index >= run.end) continue
      if (run.bold) style = style or BOLD
      if (run.italic) style = style or ITALIC
      if (run.underline) style = style or UNDERLINE
    }
    return style
  }
}
