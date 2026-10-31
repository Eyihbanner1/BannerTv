package com.bannertv.app

import android.content.Context
import android.graphics.Color
import android.os.Handler
import android.os.Looper
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
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
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
    userAgent: String,
    private val emit: (JSONObject) -> Unit,
    private val onPlayingChanged: (Boolean) -> Unit,
) : Player.Listener {
    private val handler = Handler(Looper.getMainLooper())
    private val player: ExoPlayer

    /** Something is loaded; commands other than load are ignored until then. */
    private var hasMedia = false

    /** STATE_READY has been reached at least once since the last load. */
    private var readyOnce = false

    /** The id of the last load command, sent with every event so the page can drop stale ones. */
    private var loadId = 0
    private var destroyed = false

    private val ticker: Runnable =
        object : Runnable {
            override fun run() {
                emitTime()
                handler.postDelayed(this, TIME_INTERVAL_MS)
            }
        }

    init {
        val http =
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
            "text" -> selectTrack(C.TRACK_TYPE_TEXT, stringOrNull(command, "id"))
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
        val item = MediaItem.Builder().setUri(url)
        when (Protocol.streamType(stringOrNull(command, "mime"))) {
            Protocol.STREAM_HLS -> item.setMimeType(MimeTypes.APPLICATION_M3U8)
            Protocol.STREAM_DASH -> item.setMimeType(MimeTypes.APPLICATION_MPD)
        }

        hasMedia = true
        readyOnce = false
        // Events stop() causes are still about the stream before, so they keep its id.
        player.stop()
        loadId = command.optInt("id", 0)
        // Each title starts with ExoPlayer's own audio choice and no subtitles; the page re-selects.
        player.trackSelectionParameters =
            player.trackSelectionParameters
                .buildUpon()
                .clearOverrides()
                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
                .build()
        player.setMediaItem(item.build())
        if (startAt > 0 && !startAt.isInfinite()) player.seekTo((startAt * 1000).toLong())
        player.prepare()
        player.playWhenReady = true
        view.visibility = View.VISIBLE
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

    private fun selectTrack(trackType: Int, id: String?) {
        val parameters = player.trackSelectionParameters.buildUpon()
        if (id == null) {
            // Only subtitles can be switched off; audio always keeps a track.
            if (trackType != C.TRACK_TYPE_TEXT) return
            parameters.clearOverridesOfType(C.TRACK_TYPE_TEXT).setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
        } else {
            val (groupIndex, trackIndex) = Protocol.parseTrackId(id) ?: return
            val groups = player.currentTracks.groups
            if (groupIndex >= groups.size) return
            val group = groups[groupIndex]
            if (group.type != trackType || trackIndex >= group.length) return
            parameters
                .setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, trackIndex))
                .setTrackTypeDisabled(trackType, false)
        }
        player.trackSelectionParameters = parameters.build()
    }

    private fun releaseMedia() {
        hasMedia = false
        readyOnce = false
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
                            .put("supported", group.isTrackSupported(trackIndex))
                    if (type == C.TRACK_TYPE_AUDIO) {
                        if (format.channelCount != Format.NO_VALUE) track.put("channels", format.channelCount)
                        track.put("codecs", format.codecs ?: "")
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

    override fun onPlayerError(error: PlaybackException) {
        val code = error.errorCode
        if (PlayerErrors.recoversNatively(code)) {
            // Fell behind a live window: jump back to the live edge and carry on.
            player.seekToDefaultPosition()
            player.prepare()
            return
        }
        val kind = PlayerErrors.kind(code)
        emit(
            playerEvent("error")
                .put("kind", kind)
                .put("message", PlayerErrors.message(kind, httpStatus(error)))
                .put("detail", PlayerErrors.detail(error.errorCodeName, code)),
        )
    }

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

    private fun isLive(): Boolean =
        player.isCurrentMediaItemLive || (player.isCurrentMediaItemDynamic && player.duration == C.TIME_UNSET)

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
