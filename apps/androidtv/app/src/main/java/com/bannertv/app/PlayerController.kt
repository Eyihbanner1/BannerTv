package com.bannertv.app

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.os.Handler
import android.os.Looper
import android.text.Spanned
import android.text.style.StyleSpan
import android.text.style.UnderlineSpan
import android.view.View
import android.view.ViewGroup
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.text.CueGroup
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.CaptionStyleCompat
import androidx.media3.ui.PlayerView
import androidx.media3.ui.SubtitleView
import org.json.JSONArray
import org.json.JSONObject

/**
 * The native player behind window.BannerAndroid.player(): one ExoPlayer drawing into a PlayerView
 * that sits under the transparent WebView. Main thread only.
 */
@OptIn(markerClass = [UnstableApi::class])
class PlayerController(
    context: Context,
    private val view: PlayerView,
    private val userAgent: String,
    private val emit: (JSONObject) -> Unit,
    private val onPlayingChanged: (Boolean) -> Unit,
) : Player.Listener {
    private val handler = Handler(Looper.getMainLooper())
    private val player: ExoPlayer

    /** Every request of the stream goes through this, so each load can set its own headers. */
    private val http: DefaultHttpDataSource.Factory

    /** Something is loaded; commands other than load are ignored until then. */
    private var hasMedia = false

    /** STATE_READY has been reached at least once since the last load. */
    private var readyOnce = false

    /** The stream's video has been checked against the device's decoders since the last load. */
    private var videoChecked = false

    /** The id of the last load command, sent with every event so the page can drop stale ones. */
    private var loadId = 0

    /** The last load's link and start, for opening it again as HLS. */
    private var openedUrl: String? = null
    private var openedStartAt = 0.0

    /** The page named the stream type, or it was already retried as HLS. */
    private var typeSettled = false

    /** The error from the first try, reported if the retry as HLS fails too. */
    private var firstError: PlaybackException? = null
    private var destroyed = false

    /** The subtitle track the page chose last, by its id; null while subtitles are off. */
    private var textId: String? = null

    /**
     * The page draws the subtitles inside the file itself, in the viewer's style: its text
     * command said `cues: true`. A page built before that never says so, and Android draws them.
     */
    private var pageDrawsCues = false

    /** Read for each cue group, to put its time on the page's clock. */
    private val window = Timeline.Window()

    private val ticker: Runnable =
        object : Runnable {
            override fun run() {
                emitTime()
                handler.postDelayed(this, TIME_INTERVAL_MS)
            }
        }

    init {
        http =
            DefaultHttpDataSource.Factory()
                .setAllowCrossProtocolRedirects(true)
                .setUserAgent(userAgent)
                .setConnectTimeoutMs(CONNECT_TIMEOUT_MS)
                .setReadTimeoutMs(READ_TIMEOUT_MS)
        val renderers = DefaultRenderersFactory(context).setEnableDecoderFallback(true)
        val audioAttributes =
            AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                .build()
        player =
            ExoPlayer.Builder(context, renderers)
                .setTrackSelector(DefaultTrackSelector(context))
                .setMediaSourceFactory(DefaultMediaSourceFactory(DefaultDataSource.Factory(context, http)))
                .setAudioAttributes(audioAttributes, true)
                .setHandleAudioBecomingNoisy(true)
                .build()
        // The web app chooses subtitles; until it does, none show.
        player.trackSelectionParameters =
            player.trackSelectionParameters
                .buildUpon()
                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
                .build()
        player.addListener(this)

        view.useController = false
        view.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
        view.setShutterBackgroundColor(Color.BLACK)
        view.setBackgroundColor(Color.BLACK)
        // The D-pad belongs to the WebView on top.
        view.isFocusable = false
        view.isFocusableInTouchMode = false
        view.descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS
        view.subtitleView?.let { subtitles ->
            subtitles.setStyle(
                CaptionStyleCompat(
                    Color.WHITE,
                    Color.TRANSPARENT,
                    Color.TRANSPARENT,
                    CaptionStyleCompat.EDGE_TYPE_OUTLINE,
                    Color.BLACK,
                    null,
                ),
            )
            subtitles.setFractionalTextSize(SubtitleView.DEFAULT_TEXT_SIZE_FRACTION * SUBTITLE_SCALE)
        }
        // Hidden until a load, so nothing stale ever shows under the web UI.
        view.visibility = View.GONE
        view.player = player
    }

    fun handle(command: JSONObject) {
        if (destroyed) return
        val op = command.optString("op", "")
        if (op == "load") {
            load(command)
            return
        }
        if (!hasMedia) return
        when (op) {
            "play" -> play()
            "pause" -> player.pause()
            "seek" -> seek(command)
            "audio" -> selectTrack(C.TRACK_TYPE_AUDIO, stringOrNull(command, "id"))
            "text" -> selectText(command)
            "release" -> releaseMedia()
        }
    }

    /** The app went to the background: nothing plays there. The state event tells the page. */
    fun pauseForBackground() {
        if (!destroyed) player.playWhenReady = false
    }

    fun destroy() {
        if (destroyed) return
        destroyed = true
        hasMedia = false
        handler.removeCallbacks(ticker)
        player.removeListener(this)
        view.player = null
        player.release()
    }

    private fun load(command: JSONObject) {
        val url = stringOrNull(command, "url")
        if (url.isNullOrEmpty()) return
        val startAt = command.optDouble("startAt", 0.0)
        val type = Protocol.streamType(stringOrNull(command, "mime"))
        val headers = Protocol.requestHeaders(readHeaders(command.optJSONObject("headers")))

        hasMedia = true
        // Events stop() causes are still about the stream before, so they keep its id.
        player.stop()
        // An addon's Referer, Origin or User-Agent goes with every request of this stream (playlist,
        // segments, keys), and none of the last stream's stays. ExoPlayer makes its requests after
        // this, from the factory as it is now.
        http.setUserAgent(Protocol.userAgent(headers) ?: userAgent)
        http.setDefaultRequestProperties(headers.filterKeys { !it.equals("User-Agent", ignoreCase = true) })
        loadId = command.optInt("id", 0)
        openedUrl = url
        openedStartAt = startAt
        typeSettled = type != null
        firstError = null
        textId = null
        view.subtitleView?.visibility = View.VISIBLE
        // Each title starts with ExoPlayer's own audio choice and no subtitles; the page re-selects.
        player.trackSelectionParameters =
            player.trackSelectionParameters
                .buildUpon()
                .clearOverrides()
                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
                .build()
        open(url, startAt, type)
        view.visibility = View.VISIBLE
    }

    private fun open(url: String, startAt: Double, type: String?, playWhenReady: Boolean = true) {
        val item = MediaItem.Builder().setUri(url)
        when (type) {
            Protocol.STREAM_HLS -> item.setMimeType(MimeTypes.APPLICATION_M3U8)
            Protocol.STREAM_DASH -> item.setMimeType(MimeTypes.APPLICATION_MPD)
        }
        readyOnce = false
        videoChecked = false
        player.setMediaItem(item.build())
        if (startAt > 0 && !startAt.isInfinite()) player.seekTo((startAt * 1000).toLong())
        player.prepare()
        player.playWhenReady = playWhenReady
    }

    private fun play() {
        // After an error the player is idle and needs preparing again before it can play.
        if (player.playbackState == Player.STATE_IDLE) player.prepare()
        player.play()
    }

    private fun seek(command: JSONObject) {
        val seconds = command.optDouble("position", Double.NaN)
        if (seconds.isNaN() || seconds.isInfinite()) return
        player.seekTo((seconds.coerceAtLeast(0.0) * 1000).toLong())
    }

    private fun selectText(command: JSONObject) {
        pageDrawsCues = command.optBoolean("cues", false)
        // Android's own subtitles show unless the page draws them; onCues hides them per group.
        if (!pageDrawsCues) view.subtitleView?.visibility = View.VISIBLE
        val id = stringOrNull(command, "id")
        if (selectTrack(C.TRACK_TYPE_TEXT, id)) textId = id
    }

    /** Whether the track was chosen: an id the player does not list changes nothing. */
    private fun selectTrack(trackType: Int, id: String?): Boolean {
        val parameters = player.trackSelectionParameters.buildUpon()
        if (id == null) {
            // Only subtitles can be switched off; audio always keeps a track.
            if (trackType != C.TRACK_TYPE_TEXT) return false
            parameters.clearOverridesOfType(C.TRACK_TYPE_TEXT).setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
        } else {
            val (groupIndex, trackIndex) = Protocol.parseTrackId(id) ?: return false
            val groups = player.currentTracks.groups
            if (groupIndex >= groups.size) return false
            val group = groups[groupIndex]
            if (group.type != trackType || trackIndex >= group.length) return false
            parameters
                .setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, trackIndex))
                .setTrackTypeDisabled(trackType, false)
        }
        player.trackSelectionParameters = parameters.build()
        return true
    }

    private fun releaseMedia() {
        hasMedia = false
        readyOnce = false
        textId = null
        handler.removeCallbacks(ticker)
        player.stop()
        player.clearMediaItems()
        view.visibility = View.GONE
    }

    override fun onPlaybackStateChanged(playbackState: Int) {
        if (playbackState == Player.STATE_READY) readyOnce = true
        emitState()
    }

    override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
        emitState()
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
        handler.removeCallbacks(ticker)
        if (isPlaying) handler.postDelayed(ticker, TIME_INTERVAL_MS)
        onPlayingChanged(isPlaying)
        emitState()
    }

    override fun onPositionDiscontinuity(
        oldPosition: Player.PositionInfo,
        newPosition: Player.PositionInfo,
        reason: Int,
    ) {
        if (reason == Player.DISCONTINUITY_REASON_SEEK) {
            emit(playerEvent("seeked").put("position", newPosition.positionMs.coerceAtLeast(0L) / 1000.0))
            emitTime()
        } else if (reason == Player.DISCONTINUITY_REASON_SEEK_ADJUSTMENT) {
            emitTime()
        }
    }

    override fun onTracksChanged(tracks: Tracks) {
        if (!videoChecked && tracks.containsType(C.TRACK_TYPE_VIDEO)) {
            videoChecked = true
            if (!tracks.isTypeSupported(C.TRACK_TYPE_VIDEO, true)) {
                // With no decoder here for the picture ExoPlayer plays the sound alone and calls it
                // playing. Stop, and report a format the device cannot play, so the page moves on.
                player.playWhenReady = false
                emit(
                    playerEvent("error")
                        .put("kind", PlayerErrors.FORMAT)
                        .put("message", PlayerErrors.message(PlayerErrors.FORMAT, null))
                        .put("detail", PlayerErrors.videoUnsupported(videoMime(tracks))),
                )
                return
            }
        }
        val audio = JSONArray()
        val text = JSONArray()
        tracks.groups.forEachIndexed { groupIndex, group ->
            val type = group.type
            if (type == C.TRACK_TYPE_AUDIO || type == C.TRACK_TYPE_TEXT) {
                for (trackIndex in 0 until group.length) {
                    val format = group.getTrackFormat(trackIndex)
                    val track =
                        JSONObject()
                            .put("id", Protocol.trackId(groupIndex, trackIndex))
                            .put("lang", Protocol.language(format.language))
                            .put("label", format.label ?: "")
                            .put("active", group.isTrackSelected(trackIndex))
                            .put("mime", format.sampleMimeType ?: "")
                            // For subtitles read into Media3's own cues, the type they had before: the
                            // page tells picture subtitles, which only this player can draw, from text.
                            .put("codecs", format.codecs ?: "")
                            .put("supported", group.isTrackSupported(trackIndex))
                    if (type == C.TRACK_TYPE_AUDIO) {
                        if (format.channelCount != Format.NO_VALUE) track.put("channels", format.channelCount)
                        track.put("commentary", (format.roleFlags and C.ROLE_FLAG_COMMENTARY) != 0)
                        audio.put(track)
                    } else {
                        track.put("forced", (format.selectionFlags and C.SELECTION_FLAG_FORCED) != 0)
                        text.put(track)
                    }
                }
            }
        }
        emit(playerEvent("tracks").put("audio", audio).put("text", text))
    }

    /**
     * The lines of the subtitles inside the file, for the page to draw in the viewer's style
     * when it asked to. Every group is sent, an empty one too: that is how a line ends. A group
     * with a picture in it (PGS, VobSub, DVB) is left to Android's own view, all of it.
     */
    override fun onCues(cueGroup: CueGroup) {
        val track = textId
        if (!hasMedia || !pageDrawsCues || track == null) return
        val pictures = cueGroup.cues.any { it.bitmap != null }
        // Android's view draws every group too; it only shows the ones the page cannot draw.
        view.subtitleView?.visibility = if (pictures) View.VISIBLE else View.INVISIBLE
        val cues = JSONArray()
        if (!pictures) {
            for (cue in cueGroup.cues) {
                val text = cue.text ?: continue
                val line = JSONObject().put("text", Cues.markup(text.toString(), styleRuns(text)))
                if (Cues.atTop(cue.line, cue.lineType)) line.put("top", true)
                cues.put(line)
            }
        }
        emit(
            playerEvent("cues")
                .put("track", track)
                .put("at", cueSeconds(cueGroup.presentationTimeUs))
                .put("cues", cues),
        )
    }

    override fun onPlayerError(error: PlaybackException) {
        val code = error.errorCode
        if (PlayerErrors.recoversNatively(code)) {
            // Fell behind a live window: jump back to the live edge and carry on.
            player.seekToDefaultPosition()
            player.prepare()
            return
        }
        val url = openedUrl
        if (PlayerErrors.mayBeHls(code) && !typeSettled && url != null) {
            // ExoPlayer knows HLS by ".m3u8" in the link, and IPTV and proxy links often have
            // none, so an HLS playlist reads as a file of no known kind. Try it as HLS once.
            typeSettled = true
            firstError = error
            // Paused if the page paused it while the first try opened.
            open(url, openedStartAt, Protocol.STREAM_HLS, player.playWhenReady)
            return
        }
        // If it was not HLS either, the first answer is the one that describes the link.
        val reported = firstError ?: error
        val kind = PlayerErrors.kind(reported.errorCode)
        emit(
            playerEvent("error")
                .put("kind", kind)
                .put("message", PlayerErrors.message(kind, httpStatus(reported)))
                .put("detail", PlayerErrors.detail(reported.errorCodeName, reported.errorCode)),
        )
    }

    /** The bold, italic and underlined stretches of a cue's text, as Media3's parsers mark them. */
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
    private fun cueSeconds(presentationTimeUs: Long): Double {
        val timeline = player.currentTimeline
        val windowStartUs =
            if (timeline.isEmpty) {
                0L
            } else {
                timeline.getWindow(player.currentMediaItemIndex, window).positionInFirstPeriodUs
            }
        return Cues.seconds(presentationTimeUs, windowStartUs, player.currentPosition)
    }

    private fun videoMime(tracks: Tracks): String? =
        tracks.groups.firstOrNull { it.type == C.TRACK_TYPE_VIDEO }?.getTrackFormat(0)?.sampleMimeType

    private fun emitState() {
        val state = player.playbackState
        emit(
            playerEvent("state")
                .put("playWhenReady", player.playWhenReady)
                .put("playing", player.isPlaying)
                .put("buffering", state == Player.STATE_BUFFERING)
                .put("ready", readyOnce)
                .put("ended", state == Player.STATE_ENDED)
                .put("position", positionSeconds())
                .put("duration", durationValue())
                .put("live", isLive()),
        )
    }

    private fun emitTime() {
        emit(playerEvent("time").put("position", positionSeconds()).put("duration", durationValue()))
    }

    private fun playerEvent(name: String): JSONObject =
        JSONObject().put("type", "player").put("event", name).put("load", loadId)

    private fun positionSeconds(): Double = player.currentPosition.coerceAtLeast(0L) / 1000.0

    // Only a real timeline says live. Each load starts on a placeholder timeline that is dynamic
    // and has no duration, which would make every film look like a broadcast.
    private fun isLive(): Boolean = player.isCurrentMediaItemLive

    /** Seconds, -1 for a live stream with no end, or JSON null while unknown. */
    private fun durationValue(): Any {
        if (isLive()) return -1
        val durationMs = player.duration
        return if (durationMs == C.TIME_UNSET) JSONObject.NULL else durationMs / 1000.0
    }

    /** The HTTP status behind an error, if a server refused the request. */
    private fun httpStatus(error: PlaybackException): Int? {
        var cause: Throwable? = error.cause
        while (cause != null) {
            if (cause is HttpDataSource.InvalidResponseCodeException) return cause.responseCode
            cause = cause.cause
        }
        return null
    }

    /** The load command's headers object as a map; values that are not strings are dropped. */
    private fun readHeaders(json: JSONObject?): Map<String, String?> {
        if (json == null) return emptyMap()
        val headers = HashMap<String, String?>()
        val names = json.keys()
        while (names.hasNext()) {
            val name = names.next()
            headers[name] = json.opt(name) as? String
        }
        return headers
    }

    private fun stringOrNull(command: JSONObject, key: String): String? =
        if (command.isNull(key)) null else command.optString(key, "")

    private companion object {
        const val TIME_INTERVAL_MS = 250L
        const val CONNECT_TIMEOUT_MS = 15_000
        const val READ_TIMEOUT_MS = 30_000

        // About 1.2 times Media3's default, for reading from the sofa.
        const val SUBTITLE_SCALE = 1.2f
    }
}
