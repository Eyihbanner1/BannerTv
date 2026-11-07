package com.bannertv.app

import kotlin.math.max
import kotlin.math.min

/** What a card on the Watch Next row is, which the home screen shows in its own way. */
enum class ProgramKind { MOVIE, EPISODE, CLIP }

/**
 * One card for Android TV's Watch Next row, as the page described it (ADR 0005, `watchNext`) and
 * this side checked it. No Android types, so it is built and tested without the TV provider.
 */
data class WatchNextCard(
    /** One card per title: the title's id, kept as the row's internal provider id. */
    val key: String,
    /** What the card opens. */
    val link: OpenLink,
    val kind: ProgramKind,
    val title: String,
    val episodeTitle: String?,
    val season: Int?,
    val episode: Int?,
    val description: String?,
    /** The artwork's address, and whether it is wide (16:9) rather than a poster. */
    val art: String?,
    val wideArt: Boolean,
    val positionMillis: Int,
    val durationMillis: Int,
    /** Starts from the beginning (the row's NEXT kind of card) rather than part way (CONTINUE). */
    val next: Boolean,
    /** When the title was last watched, in milliseconds since 1970: the row's order. */
    val watchedAt: Long,
)

/** One of BannerTV's rows in the TV provider, as far as the plan needs it. */
data class WatchNextRow(val id: Long, val key: String?, val browsable: Boolean, val watchedAt: Long)

/** One change to make to the TV provider. */
sealed interface WatchNextChange {
    data class Insert(val card: WatchNextCard) : WatchNextChange

    data class Update(val id: Long, val card: WatchNextCard) : WatchNextChange

    data class Delete(val id: Long) : WatchNextChange
}

/** Turns the page's list into cards, and works out what changes the row. */
object WatchNextPlan {
    /** More than Continue Watching ever holds (20), so nothing it shows is lost. */
    const val MAX_CARDS: Int = 30

    private const val MAX_TITLE = 200
    private const val MAX_DESCRIPTION = 500
    private const val MAX_URL = 2048
    private val ART_URL = Regex("""https?://[^\s/?#]+([/?#]\S*)?""", RegexOption.IGNORE_CASE)

    /**
     * A card from what the page sent, or null when an id or the title is missing or wrong. The
     * page's lengths are seconds; the row's are milliseconds. Artwork must be an http or https
     * address, which the home screen fetches itself, and wide artwork goes first.
     */
    fun card(
        type: String?,
        meta: String?,
        video: String?,
        title: String?,
        episodeTitle: String? = null,
        season: Int? = null,
        episode: Int? = null,
        description: String? = null,
        landscape: String? = null,
        poster: String? = null,
        position: Double = 0.0,
        duration: Double = 0.0,
        next: Boolean = false,
        watchedAt: Long = 0,
    ): WatchNextCard? {
        val kindOf = type?.takeIf(DeepLink::isType) ?: return null
        val key = meta?.takeIf(DeepLink::isId) ?: return null
        val plays = video?.takeIf(DeepLink::isId) ?: return null
        val name = text(title, MAX_TITLE) ?: return null
        val wide = artUrl(landscape)
        val art = wide ?: artUrl(poster)
        val durationMillis = millis(duration)
        // A place past the end is no place: the bar would overflow.
        val positionMillis =
            when {
                next -> 0
                durationMillis > 0 -> min(millis(position), durationMillis)
                else -> millis(position)
            }
        val episodeNumber = episode?.takeIf { it >= 0 }
        return WatchNextCard(
            key = key,
            link = OpenLink(kindOf, key, plays),
            kind =
                when {
                    episodeNumber != null -> ProgramKind.EPISODE
                    kindOf == "movie" -> ProgramKind.MOVIE
                    else -> ProgramKind.CLIP
                },
            title = name,
            episodeTitle = text(episodeTitle, MAX_TITLE),
            season = season?.takeIf { it >= 0 },
            episode = episodeNumber,
            description = text(description, MAX_DESCRIPTION),
            art = art,
            wideArt = art != null && art == wide,
            positionMillis = positionMillis,
            durationMillis = durationMillis,
            next = next,
            watchedAt = max(0L, watchedAt),
        )
    }

    /** Seconds as whole milliseconds; 0 for anything unknown or below zero. */
    fun millis(seconds: Double): Int =
        if (!seconds.isFinite() || seconds <= 0) 0 else min(seconds * 1000, Int.MAX_VALUE.toDouble()).toInt()

    /**
     * What changes the row from `rows` (BannerTV's, as the provider has them) to `cards`. Rows of
     * titles no longer on Continue Watching go, as does a second row for one title. A row the
     * person took off the home screen is not browsable any more: it is left alone, and comes back
     * only once they watch the title again. `written` is what this run last wrote to each row, so a
     * card that has not changed is not written again.
     */
    fun plan(
        cards: List<WatchNextCard>,
        rows: List<WatchNextRow>,
        written: Map<Long, WatchNextCard> = emptyMap(),
    ): List<WatchNextChange> {
        val wanted = LinkedHashMap<String, WatchNextCard>()
        for (card in cards.take(MAX_CARDS)) {
            if (card.key !in wanted) wanted[card.key] = card
        }
        val changes = ArrayList<WatchNextChange>()
        val kept = HashMap<String, WatchNextRow>()
        for (row in rows) {
            val key = row.key
            if (key == null || key !in wanted || key in kept) {
                changes.add(WatchNextChange.Delete(row.id))
            } else {
                kept[key] = row
            }
        }
        for ((key, card) in wanted) {
            val row = kept[key]
            when {
                row == null -> changes.add(WatchNextChange.Insert(card))
                row.browsable -> if (written[row.id] != card) changes.add(WatchNextChange.Update(row.id, card))
                card.watchedAt > row.watchedAt -> {
                    // Only the system can make a row browsable again, so it is made anew.
                    changes.add(WatchNextChange.Delete(row.id))
                    changes.add(WatchNextChange.Insert(card))
                }
            }
        }
        return changes
    }

    private fun text(value: String?, limit: Int): String? = value?.trim()?.take(limit)?.ifEmpty { null }

    private fun artUrl(url: String?): String? = url?.trim()?.takeIf { it.length <= MAX_URL && ART_URL.matches(it) }
}
