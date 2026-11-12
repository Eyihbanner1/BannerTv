package expo.modules.bannercues

import kotlin.math.roundToInt

/**
 * Where Media3 may draw the picture subtitles (PGS, DVB) it still draws itself, so they stay on
 * the screen whatever the picture's size and place. Pure, so it needs nothing from Android.
 *
 * Media3 draws them in its subtitle view, which covers the picture's whole frame, at places and
 * sizes given as shares of that view less its padding, across and down each on its own.
 * Fitted, the frame is on the screen and the view needs no padding. Past fit the frame runs off
 * the screen, and moved, it sits off centre, so subtitles near its edges would be drawn where
 * nobody sees them. Padded down to the box the whole frame takes fitted in the screen and
 * centred, the view draws them where they show with the picture fitted: on the screen, at that
 * size.
 *
 * The box always has the frame's shape, since a box of any other shape would stretch them.
 * Media3's frame is not always the shape the app lays the player out at: a file the app sizes
 * by its stored size, with pixels that are not square or turned on its side, and any file for
 * the moment before its size is known, shows at its own shape inside the player's rectangle,
 * short of it one way. The box fitted in the screen can then reach past the frame, where no
 * padding takes the view. So the box is the largest of the frame's shape in the part of the
 * frame on the screen, centred on the screen as near as that part allows. That is the box
 * fitted in the screen whenever the frame covers it, and otherwise a smaller one: the subtitles
 * show smaller, still on the screen, never stretched.
 */
object ScreenFit {
  /** A rectangle in pixels, measured from the same corner as the one it is used with. */
  data class Box(val left: Int, val top: Int, val width: Int, val height: Int) {
    val right: Int get() = left + width
    val bottom: Int get() = top + height
  }

  /** How far in from each edge of the subtitle view Media3 draws, in pixels. */
  data class Padding(val left: Int, val top: Int, val right: Int, val bottom: Int)

  /** No padding: Media3 draws across the whole frame. */
  val NONE = Padding(0, 0, 0, 0)

  /**
   * The padding for the subtitle view at `view` on the screen at `screen`, both measured in the
   * window, or null while either has no size yet.
   */
  fun padding(view: Box, screen: Box): Padding? {
    if (view.width <= 0 || view.height <= 0 || screen.width <= 0 || screen.height <= 0) {
      return null
    }
    // The part of the frame on the screen, which the box has to be in: in the frame, since
    // padding only takes the view in, and on the screen. Fitted, or in picture-in-picture's
    // small window, that is the whole frame, and so is the box: no padding.
    val left = maxOf(view.left, screen.left)
    val top = maxOf(view.top, screen.top)
    val right = minOf(view.right, screen.right)
    val bottom = minOf(view.bottom, screen.bottom)
    // None of the frame on the screen: nothing Media3 draws in it would show anyway.
    if (right <= left || bottom <= top) return NONE
    // The frame's shape as large as that part takes, so never larger than the frame, and, as
    // the part is on the screen, never larger than the frame fitted in it.
    val scale =
      minOf((right - left).toFloat() / view.width, (bottom - top).toFloat() / view.height)
    val width = view.width * scale
    val height = view.height * scale
    // Each side on its own, since a moved picture is not centred on the screen.
    val boxLeft = within(screen.left + (screen.width - width) / 2f, left, right - width)
    val boxTop = within(screen.top + (screen.height - height) / 2f, top, bottom - height)
    val padding = Padding(
      maxOf(0, (boxLeft - view.left).roundToInt()),
      maxOf(0, (boxTop - view.top).roundToInt()),
      maxOf(0, (view.right - boxLeft - width).roundToInt()),
      maxOf(0, (view.bottom - boxTop - height).roundToInt()),
    )
    // A box rounded to nothing, for a frame all but off the screen, would leave Media3 nowhere
    // to draw.
    val room = padding.left + padding.right < view.width &&
      padding.top + padding.bottom < view.height
    return if (room) padding else NONE
  }

  /**
   * `at`, or the nearest place to it from `first` to `last`. `first` should they cross, as they
   * can by part of a pixel for a box as long as the part it is in.
   */
  private fun within(at: Float, first: Int, last: Float): Float =
    maxOf(first.toFloat(), minOf(at, last))
}
