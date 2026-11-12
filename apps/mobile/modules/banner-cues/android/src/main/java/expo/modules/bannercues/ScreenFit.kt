package expo.modules.bannercues

import kotlin.math.roundToInt

/**
 * Where Media3 may draw the picture subtitles (PGS, DVB) it still draws itself, so they stay on
 * the screen whatever the picture's size and place. Pure, so it needs nothing from Android.
 *
 * Media3 draws them in its subtitle view, which covers the picture's whole frame, at places and
 * sizes given as shares of that view less its padding. Fitted, the frame is on the screen and
 * the view needs no padding. Past fit the frame runs off the screen, and moved, it sits off
 * centre, so subtitles near its edges would be drawn where nobody sees them. Padded down to the
 * box the whole frame takes fitted in the screen and centred, the view draws them where they
 * show with the picture fitted: on the screen, at that size, and never stretched, since the box
 * has the frame's shape.
 */
object ScreenFit {
  /** A rectangle in pixels, measured from the same corner as the one it is used with. */
  data class Box(val left: Int, val top: Int, val width: Int, val height: Int) {
    val right: Int get() = left + width
    val bottom: Int get() = top + height
  }

  /** How far in from each edge of the subtitle view Media3 draws, in pixels. */
  data class Padding(val left: Int, val top: Int, val right: Int, val bottom: Int)

  /** No padding: the whole frame is on the screen already. */
  val NONE = Padding(0, 0, 0, 0)

  /**
   * The padding for the subtitle view at `view` on the screen at `screen`, both measured in the
   * window, or null while either has no size yet.
   */
  fun padding(view: Box, screen: Box): Padding? {
    if (view.width <= 0 || view.height <= 0 || screen.width <= 0 || screen.height <= 0) {
      return null
    }
    // The whole frame on the screen, as fitted or in picture-in-picture's small window: Media3
    // draws on the screen already.
    if (view.left >= screen.left && view.top >= screen.top &&
      view.right <= screen.right && view.bottom <= screen.bottom
    ) {
      return NONE
    }
    // Only ever smaller: the box is inside the view, so it is never bigger than the frame.
    val scale =
      minOf(1f, screen.width.toFloat() / view.width, screen.height.toFloat() / view.height)
    val width = view.width * scale
    val height = view.height * scale
    val (left, right) =
      ends(view.left, view.width, screen.left + (screen.width - width) / 2f, width)
    val (top, bottom) =
      ends(view.top, view.height, screen.top + (screen.height - height) / 2f, height)
    return Padding(left, top, right, bottom)
  }

  /**
   * The padding at the two ends of one of the view's sides, `length` long from `start`, that
   * brings it in to the box's side, `boxLength` long from `boxStart`. Each end is padded on its
   * own, since a moved picture is not centred on the screen. None at an end the box reaches past,
   * as it can by part of a pixel for a frame all but fitted, and none at either end if nothing
   * would be left between them, as for a frame off the screen that way.
   */
  private fun ends(start: Int, length: Int, boxStart: Float, boxLength: Float): Pair<Int, Int> {
    val before = maxOf(0, (boxStart - start).roundToInt())
    val after = maxOf(0, (start + length - (boxStart + boxLength)).roundToInt())
    return if (before + after < length) Pair(before, after) else Pair(0, 0)
  }
}
