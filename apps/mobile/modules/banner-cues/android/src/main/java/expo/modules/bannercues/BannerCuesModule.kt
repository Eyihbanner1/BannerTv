package expo.modules.bannercues

import android.graphics.Typeface
import android.os.Handler
import android.os.Looper
import android.text.Spanned
import android.text.style.StyleSpan
import android.text.style.UnderlineSpan
import android.view.View
import android.view.ViewTreeObserver
import androidx.annotation.OptIn
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.text.CueGroup
import androidx.media3.common.util.UnstableApi
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.video.player.VideoPlayer
import java.lang.ref.WeakReference
import kotlinx.coroutines.launch

/**
 * Hands the page the lines of the subtitle track inside the file as they show, as the Android TV
 * app's PlayerController does ({ "event": "cues" }, ADR 0005 decision 6), so the page draws them
 * in the profile's subtitle style. expo-video plays through Media3 but tells JS nothing of its
 * cues, so this listens on the ExoPlayer inside expo-video's VideoPlayer, and hides Media3's own
 * subtitle view while the page draws the lines. Picture subtitles (PGS, DVB) stay with Media3,
 * kept on the screen whatever the picture's size and place (ScreenFit).
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

  /** The subtitle view keepOnScreen fits, while it follows one. */
  private var fitted: WeakReference<View>? = null

  /** Where a view is on the window, read into at each measure (on the main thread only). */
  private val location = IntArray(2)

  // Media3's subtitle view covers the picture's whole frame, so past fit it runs off the screen,
  // and moved, it sits off centre; ScreenFit says how to pad it so picture subtitles stay on the
  // screen. Measured again just before the window draws each frame, not only as the subtitle
  // view is laid out: moving the picture lays its view out in a new place but leaves the
  // subtitle view where it was inside it, so nothing of the subtitle view's own changes. Whatever
  // moves the frame is drawn, though: a move, a pinch, turning the phone, picture-in-picture.
  // Android's SurfaceView, which the video is drawn on, keeps up with its place on the screen the
  // same way. It costs a few reads a frame. The padding is set after the frame, not during it,
  // and only when the answer changes, so the layout that setting it causes ends there.
  private val fitBeforeDraw = ViewTreeObserver.OnPreDrawListener {
    val view = fitted?.get()
    val padding = view?.let { screenPadding(it) }
    if (view != null && padding != null && !hasPadding(view, padding)) {
      view.removeCallbacks(fitLater)
      view.post(fitLater)
    }
    true
  }

  private val fitLater = Runnable { fitted?.get()?.let { fitInScreen(it) } }

  // fitBeforeDraw is on the tree of the window the subtitle view is in, so it comes off as the
  // view leaves a window and goes on again as it joins one: for a moment as expo-video moves the
  // player into picture-in-picture and back, and for good as the player screen closes.
  private val fitOnAttach = object : View.OnAttachStateChangeListener {
    override fun onViewAttachedToWindow(view: View) {
      view.viewTreeObserver.addOnPreDrawListener(fitBeforeDraw)
    }

    override fun onViewDetachedFromWindow(view: View) {
      view.viewTreeObserver.removeOnPreDrawListener(fitBeforeDraw)
    }
  }

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
      // The player and the subtitle view are used on the main thread only.
      Handler(Looper.getMainLooper()).post {
        video?.player?.removeListener(listener)
        unfollow()
      }
    }
  }

  private fun watch(video: VideoPlayer) {
    val current = watched?.get()
    if (current === video) return
    current?.player?.removeListener(listener)
    // The subtitle view the last player was shown on is not this one's to fit.
    unfollow()
    watched = WeakReference(video)
    video.player.addListener(listener)
  }

  /** Media3's subtitle view on the screen that shows the player, if one does. */
  private fun subtitleView() = watched?.get()?.currentVideoView?.playerView?.subtitleView

  private fun keepOnScreen() {
    val view: View = subtitleView() ?: return
    if (fitted?.get() !== view) {
      unfollow()
      view.addOnAttachStateChangeListener(fitOnAttach)
      if (view.isAttachedToWindow) view.viewTreeObserver.addOnPreDrawListener(fitBeforeDraw)
      fitted = WeakReference(view)
    }
    fitInScreen(view)
  }

  /** Stops fitting the subtitle view followed until now, and takes every listener off it. */
  private fun unfollow() {
    val view = fitted?.get()
    fitted = null
    if (view == null) return
    view.removeOnAttachStateChangeListener(fitOnAttach)
    if (view.isAttachedToWindow) view.viewTreeObserver.removeOnPreDrawListener(fitBeforeDraw)
    view.removeCallbacks(fitLater)
  }

  private fun fitInScreen(view: View) {
    val padding = screenPadding(view) ?: return
    if (!hasPadding(view, padding)) {
      view.setPadding(padding.left, padding.top, padding.right, padding.bottom)
    }
  }

  private fun hasPadding(view: View, padding: ScreenFit.Padding) =
    view.paddingLeft == padding.left && view.paddingTop == padding.top &&
      view.paddingRight == padding.right && view.paddingBottom == padding.bottom

  /**
   * The padding that keeps the picture subtitles `view` draws on the screen, or null while it
   * cannot be measured: out of a window, or not laid out yet.
   */
  private fun screenPadding(view: View): ScreenFit.Padding? {
    if (!view.isAttachedToWindow) return null
    val screen = screenOf(view)
    view.getLocationInWindow(location)
    val frame = ScreenFit.Box(location[0], location[1], view.width, view.height)
    screen.getLocationInWindow(location)
    return ScreenFit.padding(
      frame,
      ScreenFit.Box(location[0], location[1], screen.width, screen.height),
    )
  }

  /**
   * What the viewer sees of the window `view` is in: its content view, which the app's views
   * fill (or the window's root view, if it has none). The player screen fills it too, drawn edge
   * to edge with the system bars hidden, so it is the screen the player measures to fit the
   * picture, and the frame fitted in it is the frame the viewer sees at fit. Not the player's own
   * view, which past fit is the picture's whole frame; not the decor view, which can also take in
   * the place of a system bar the app draws nothing under; and not the part the system bars leave
   * clear, which changes as they show for a moment over the picture. In picture-in-picture
   * expo-video moves the player into this same view, which Android then lays out as the small
   * window, so the frame fits there.
   */
  private fun screenOf(view: View): View {
    val root = view.rootView
    return root.findViewById<View>(android.R.id.content) ?: root
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
