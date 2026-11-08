package expo.modules.bannercues

import android.graphics.Typeface
import android.os.Handler
import android.os.Looper
import android.text.Spanned
import android.text.style.StyleSpan
import android.text.style.UnderlineSpan
import android.view.View
import androidx.annotation.OptIn
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.text.CueGroup
import androidx.media3.common.util.UnstableApi
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.video.player.VideoPlayer
import java.lang.ref.WeakReference
import kotlin.math.roundToInt
import kotlinx.coroutines.launch

/**
 * Hands the page the lines of the subtitle track inside the file as they show, as the Android TV
 * app's PlayerController does ({ "event": "cues" }, ADR 0005 decision 6), so the page draws them
 * in the profile's subtitle style. expo-video plays through Media3 but tells JS nothing of its
 * cues, so this listens on the ExoPlayer inside expo-video's VideoPlayer, and hides Media3's own
 * subtitle view while the page draws the lines. Picture subtitles (PGS, DVB) stay with Media3,
 * kept inside the screen when the picture is zoomed to fill it.
 */
@OptIn(markerClass = [UnstableApi::class])
class BannerCuesModule : Module() {
  private var watched: WeakReference<VideoPlayer>? = null

  /** Whether the page draws the lines (set with each subtitle choice); until then Media3 does. */
  private var pageDraws = false
  private val window = Timeline.Window()

  private val listener = object : Player.Listener {
    override fun onCues(cueGroup: CueGroup) {
      keepOnScreen()
      send(cueGroup)
    }
  }

  /** The subtitle view keepOnScreen listens on. */
  private var fitted: WeakReference<View>? = null

  // Zoomed to fill the screen (the player's contentFit "cover"), Media3's content frame, and
  // the subtitle view inside it, is larger than the screen, so a picture subtitle near the
  // frame's edge would be cut off. Padding the subtitle view down to the whole frame fitted in
  // the screen draws Media3's subtitles where they are with the picture fitted: on the screen,
  // and never stretched. With the picture fitted the padding is none. Measured again whenever
  // the view is laid out, as it is when the fit changes; after that layout, not during it.
  private val fitOnLayout =
    View.OnLayoutChangeListener { view, _, _, _, _, _, _, _, _ -> view.post { fitInScreen(view) } }

  override fun definition() = ModuleDefinition {
    Name("BannerCues")
    Events("cues")

    // The player phone-host.ts makes once and keeps. ExoPlayer is used on the main thread only.
    Function("watch") { video: VideoPlayer ->
      appContext.mainQueue.launch {
        watch(video)
      }
    }

    Function("draw") { on: Boolean ->
      appContext.mainQueue.launch {
        pageDraws = on
        keepOnScreen()
        if (!on) {
          subtitleView()?.visibility = View.VISIBLE
        } else {
          // The lines on screen now, so the page shows them at once and Media3's view, which
          // drew them while the page didn't (picture-in-picture), hides them again.
          watched?.get()?.let { send(it.player.currentCues) }
        }
      }
    }

    OnDestroy {
      val video = watched?.get()
      watched = null
      if (video != null) {
        Handler(Looper.getMainLooper()).post { video.player.removeListener(listener) }
      }
    }
  }

  private fun watch(video: VideoPlayer) {
    val current = watched?.get()
    if (current === video) return
    current?.player?.removeListener(listener)
    watched = WeakReference(video)
    video.player.addListener(listener)
  }

  /** Media3's subtitle view on the screen that shows the player, if one does. */
  private fun subtitleView() = watched?.get()?.currentVideoView?.playerView?.subtitleView

  private fun keepOnScreen() {
    val view: View = subtitleView() ?: return
    if (fitted?.get() !== view) {
      fitted?.get()?.removeOnLayoutChangeListener(fitOnLayout)
      view.addOnLayoutChangeListener(fitOnLayout)
      fitted = WeakReference(view)
    }
    fitInScreen(view)
  }

  private fun fitInScreen(view: View) {
    // The subtitle view fills the content frame, which sits centred in the player view.
    val screen = (view.parent as? View)?.parent as? View ?: return
    val width = view.width
    val height = view.height
    if (width <= 0 || height <= 0 || screen.width <= 0 || screen.height <= 0) return
    val scale = minOf(1f, screen.width.toFloat() / width, screen.height.toFloat() / height)
    val x = (width * (1f - scale) / 2f).roundToInt()
    val y = (height * (1f - scale) / 2f).roundToInt()
    if (view.paddingLeft != x || view.paddingTop != y ||
      view.paddingRight != x || view.paddingBottom != y
    ) {
      view.setPadding(x, y, x, y)
    }
  }

  private fun send(cueGroup: CueGroup) {
    val video = watched?.get() ?: return
    if (!pageDraws) return
    val pictures = cueGroup.cues.any { it.bitmap != null }
    // Media3's view draws every group too; it only shows the ones the page cannot draw.
    subtitleView()?.visibility = if (pictures) View.VISIBLE else View.INVISIBLE
    val lines = ArrayList<Map<String, Any>>()
    if (!pictures) {
      for (cue in cueGroup.cues) {
        val text = cue.text ?: continue
        val line = HashMap<String, Any>()
        line["text"] = Cues.markup(text.toString(), styleRuns(text))
        if (Cues.atTop(cue.line, cue.lineType)) line["top"] = true
        lines.add(line)
      }
    }
    sendEvent("cues", mapOf("at" to seconds(video, cueGroup.presentationTimeUs), "cues" to lines))
  }

  private fun styleRuns(text: CharSequence): List<Cues.Run> {
    if (text !is Spanned) return emptyList()
    val runs = ArrayList<Cues.Run>()
    for (span in text.getSpans(0, text.length, StyleSpan::class.java)) {
      val bold = (span.style and Typeface.BOLD) != 0
      val italic = (span.style and Typeface.ITALIC) != 0
      if (bold || italic) {
        runs.add(Cues.Run(text.getSpanStart(span), text.getSpanEnd(span), bold, italic, false))
      }
    }
    for (span in text.getSpans(0, text.length, UnderlineSpan::class.java)) {
      runs.add(Cues.Run(text.getSpanStart(span), text.getSpanEnd(span), false, false, true))
    }
    return runs
  }

  /** A cue group's time in seconds on the page's clock, which is the window's. */
  private fun seconds(video: VideoPlayer, presentationTimeUs: Long): Double {
    val player = video.player
    val timeline = player.currentTimeline
    val windowStartUs =
      if (timeline.isEmpty) {
        0L
      } else {
        timeline.getWindow(player.currentMediaItemIndex, window).positionInFirstPeriodUs
      }
    return Cues.seconds(presentationTimeUs, windowStartUs, player.currentPosition)
  }
}
