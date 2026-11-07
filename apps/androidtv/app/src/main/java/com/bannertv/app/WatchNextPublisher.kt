package com.bannertv.app

import android.content.ContentResolver
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.BaseColumns
import androidx.tvprovider.media.tv.TvContractCompat
import androidx.tvprovider.media.tv.TvContractCompat.PreviewProgramColumns
import androidx.tvprovider.media.tv.TvContractCompat.WatchNextPrograms
import androidx.tvprovider.media.tv.WatchNextProgram
import org.json.JSONException
import org.json.JSONObject
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicReference

/**
 * Puts the page's Continue Watching on Android TV's own Watch Next row ("Continue watching" on
 * Google TV), through the system's TV provider. Each list from the page replaces BannerTV's cards
 * on the row. The provider is a database in another process, so the work runs on a thread of its
 * own, and only the newest list matters: one that arrives while an older one is written replaces
 * it. Nothing here ever reaches the page, and the cards hold ids, words and artwork only.
 */
class WatchNextPublisher(context: Context) {
    private val app: Context = context.applicationContext
    private val worker: ExecutorService = Executors.newSingleThreadExecutor()
    private val latest = AtomicReference<List<WatchNextCard>?>(null)

    // What this run wrote to each row, so a card that has not changed is not written again.
    // Used on the worker thread only.
    private val written = HashMap<Long, WatchNextCard>()

    /**
     * Whether the device has the row: Android TV and Google TV from Android 8. A phone has no TV
     * home screen, and Fire TV's home screen has no Watch Next row, so neither is written to.
     */
    val available: Boolean =
        Build.VERSION.SDK_INT >= 26 &&
            hasFeature(PackageManager.FEATURE_LEANBACK) &&
            !hasFeature(FEATURE_FIRE_TV)

    /** Takes the page's list (ADR 0005, `watchNext`). Called on the WebView's bridge thread. */
    fun publish(json: String) {
        if (!available) return
        val cards = parse(json) ?: return
        if (latest.getAndSet(cards) != null) return
        try {
            worker.execute(::drain)
        } catch (e: RejectedExecutionException) {
            // The activity is closing: the next launch publishes again.
        }
    }

    /** Lets a list being written finish, and takes no more. */
    fun close() {
        worker.shutdown()
    }

    private fun drain() {
        while (true) {
            val cards = latest.getAndSet(null) ?: return
            sync(cards)
        }
    }

    private fun sync(cards: List<WatchNextCard>) {
        val resolver = app.contentResolver
        // Unreadable (the provider restarting, say): the page's next list tries again.
        val rows = rows(resolver) ?: return
        for (change in WatchNextPlan.plan(cards, rows, written)) {
            try {
                apply(resolver, change)
            } catch (e: Exception) {
                // One card the provider refuses must not keep the others off the row.
            }
        }
    }

    private fun apply(resolver: ContentResolver, change: WatchNextChange) {
        when (change) {
            is WatchNextChange.Delete -> {
                resolver.delete(TvContractCompat.buildWatchNextProgramUri(change.id), null, null)
                written.remove(change.id)
            }
            is WatchNextChange.Insert -> {
                val uri = resolver.insert(WatchNextPrograms.CONTENT_URI, program(change.card).toContentValues())
                if (uri != null) written[ContentUris.parseId(uri)] = change.card
            }
            is WatchNextChange.Update -> {
                val uri = TvContractCompat.buildWatchNextProgramUri(change.id)
                resolver.update(uri, program(change.card).toContentValues(), null, null)
                written[change.id] = change.card
            }
        }
    }

    /**
     * BannerTV's rows on the row, or null when the provider cannot be read: it shows an app its own
     * and nobody else's.
     */
    private fun rows(resolver: ContentResolver): List<WatchNextRow>? =
        try {
            resolver.query(WatchNextPrograms.CONTENT_URI, ROW_COLUMNS, null, null, null)?.use {
                val rows = ArrayList<WatchNextRow>(it.count)
                while (it.moveToNext()) {
                    rows.add(
                        WatchNextRow(
                            id = it.getLong(0),
                            key = if (it.isNull(1)) null else it.getString(1),
                            // Only the system clears it, when the person takes the card off the row.
                            browsable = it.isNull(2) || it.getInt(2) != 0,
                            watchedAt = if (it.isNull(3)) 0L else it.getLong(3),
                        ),
                    )
                }
                rows
            }
        } catch (e: Exception) {
            // The provider can also go away while its rows are read. This runs on a thread of its
            // own, where anything thrown would take the whole app down.
            null
        }

    /**
     * The provider's row for a card. Every field is written each time, empty ones too, so a card
     * that moves on to the next episode keeps nothing of the last one.
     */
    private fun program(card: WatchNextCard): WatchNextProgram {
        val watchNextType =
            if (card.next) WatchNextPrograms.WATCH_NEXT_TYPE_NEXT else WatchNextPrograms.WATCH_NEXT_TYPE_CONTINUE
        val aspectRatio =
            if (card.wideArt) {
                PreviewProgramColumns.ASPECT_RATIO_16_9
            } else {
                PreviewProgramColumns.ASPECT_RATIO_MOVIE_POSTER
            }
        val builder = WatchNextProgram.Builder()
        builder
            .setWatchNextType(watchNextType)
            .setLastEngagementTimeUtcMillis(card.watchedAt)
            .setType(programType(card.kind))
            .setTitle(card.title)
            .setEpisodeTitle(card.episodeTitle)
            .setSeasonNumber(card.season?.toString(), card.season ?: 0)
            .setEpisodeNumber(card.episode?.toString(), card.episode ?: 0)
            .setDescription(card.description)
            .setPosterArtUri(card.art?.let(Uri::parse))
            .setPosterArtAspectRatio(aspectRatio)
            .setLastPlaybackPositionMillis(card.positionMillis)
            .setDurationMillis(card.durationMillis)
            .setInternalProviderId(card.key)
            .setContentId(card.key)
            .setIntent(intentFor(card.link))
        return builder.build()
    }

    /**
     * What the card opens: this app's own link, held to this package, since the phone app answers
     * bannertv:// links too and a debug build sits beside the release one.
     */
    private fun intentFor(link: OpenLink): Intent =
        Intent(Intent.ACTION_VIEW, Uri.parse(DeepLink.build(link)))
            .setPackage(app.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    private fun hasFeature(name: String): Boolean =
        try {
            app.packageManager.hasSystemFeature(name)
        } catch (e: Exception) {
            false
        }

    private companion object {
        const val FEATURE_FIRE_TV = "amazon.hardware.fire_tv"

        val ROW_COLUMNS =
            arrayOf(
                BaseColumns._ID,
                PreviewProgramColumns.COLUMN_INTERNAL_PROVIDER_ID,
                PreviewProgramColumns.COLUMN_BROWSABLE,
                WatchNextPrograms.COLUMN_LAST_ENGAGEMENT_TIME_UTC_MILLIS,
            )

        fun programType(kind: ProgramKind): Int =
            when (kind) {
                ProgramKind.MOVIE -> PreviewProgramColumns.TYPE_MOVIE
                ProgramKind.EPISODE -> PreviewProgramColumns.TYPE_TV_EPISODE
                ProgramKind.CLIP -> PreviewProgramColumns.TYPE_CLIP
            }

        /** The page's list, or null when it is not one (nothing changes then). */
        fun parse(json: String): List<WatchNextCard>? {
            val list =
                try {
                    JSONObject(json).optJSONArray("cards")
                } catch (e: JSONException) {
                    null
                } ?: return null
            val cards = ArrayList<WatchNextCard>()
            for (index in 0 until minOf(list.length(), WatchNextPlan.MAX_CARDS)) {
                val item = list.optJSONObject(index) ?: continue
                val card =
                    WatchNextPlan.card(
                        type = text(item, "type"),
                        meta = text(item, "meta"),
                        video = text(item, "video"),
                        title = text(item, "title"),
                        episodeTitle = text(item, "episodeTitle"),
                        season = count(item, "season"),
                        episode = count(item, "episode"),
                        description = text(item, "description"),
                        landscape = text(item, "landscape"),
                        poster = text(item, "poster"),
                        position = item.optDouble("position", 0.0),
                        duration = item.optDouble("duration", 0.0),
                        next = item.optBoolean("next", false),
                        watchedAt = item.optLong("watchedAt", 0L),
                    )
                if (card != null) cards.add(card)
            }
            return cards
        }

        // optString gives "null" for a JSON null, so a missing or null field is checked first.
        fun text(item: JSONObject, name: String): String? = if (item.isNull(name)) null else item.optString(name)

        fun count(item: JSONObject, name: String): Int? =
            if (item.isNull(name)) null else item.optInt(name, -1).takeIf { it >= 0 }
    }
}
