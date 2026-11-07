package com.bannertv.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class WatchNextPlanTest {
    private fun film(meta: String, watchedAt: Long = 1000, position: Double = 600.0): WatchNextCard =
        WatchNextPlan.card(
            type = "movie",
            meta = meta,
            video = meta,
            title = "Film $meta",
            position = position,
            duration = 6000.0,
            watchedAt = watchedAt,
        )!!

    @Test
    fun aFilmLeftPartWayKeepsItsPlaceInMilliseconds() {
        val card =
            WatchNextPlan.card(
                type = "movie",
                meta = "tt1",
                video = "tt1",
                title = "  Big Buck Bunny  ",
                description = "A rabbit.",
                landscape = "https://images.example/tt1/wide.jpg",
                poster = "https://images.example/tt1/poster.jpg",
                position = 61.5,
                duration = 596.0,
                watchedAt = 1_730_000_000_000,
            )
        assertEquals(
            WatchNextCard(
                key = "tt1",
                link = OpenLink("movie", "tt1", "tt1"),
                kind = ProgramKind.MOVIE,
                title = "Big Buck Bunny",
                episodeTitle = null,
                season = null,
                episode = null,
                description = "A rabbit.",
                art = "https://images.example/tt1/wide.jpg",
                wideArt = true,
                positionMillis = 61_500,
                durationMillis = 596_000,
                next = false,
                watchedAt = 1_730_000_000_000,
            ),
            card,
        )
    }

    @Test
    fun theNextEpisodeStartsFromTheBeginningWithItsPoster() {
        val card =
            WatchNextPlan.card(
                type = "series",
                meta = "tt8000001",
                video = "tt8000001:1:2",
                title = "Morevna Project S1:E2",
                episodeTitle = "The Second",
                season = 1,
                episode = 2,
                landscape = "ftp://images.example/wide.jpg",
                poster = "https://images.example/poster.jpg",
                position = 120.0,
                next = true,
            )!!
        assertEquals(ProgramKind.EPISODE, card.kind)
        assertEquals(OpenLink("series", "tt8000001", "tt8000001:1:2"), card.link)
        assertEquals(0, card.positionMillis)
        assertEquals(0, card.durationMillis)
        // Only http and https artwork reaches the home screen.
        assertEquals("https://images.example/poster.jpg", card.art)
        assertEquals(false, card.wideArt)
    }

    @Test
    fun keepsThePlaceWithinTheLength() {
        assertEquals(6_000_000, film("tt1", position = 9000.0).positionMillis)
        assertEquals(0, film("tt1", position = Double.NaN).positionMillis)
        assertEquals(0, WatchNextPlan.millis(-5.0))
        assertEquals(Int.MAX_VALUE, WatchNextPlan.millis(1e12))
    }

    @Test
    fun aVideoThatIsNeitherFilmNorEpisodeIsAClip() {
        val card = WatchNextPlan.card(type = "channel", meta = "yt:1", video = "yt:1:v", title = "A video")!!
        assertEquals(ProgramKind.CLIP, card.kind)
        assertNull(card.art)
    }

    @Test
    fun refusesACardWithoutItsIdsOrTitle() {
        assertNull(WatchNextPlan.card(type = "movie", meta = "tt1", video = "tt1", title = "   "))
        assertNull(WatchNextPlan.card(type = "movie", meta = "tt1", video = null, title = "Film"))
        assertNull(WatchNextPlan.card(type = "movie", meta = "", video = "tt1", title = "Film"))
        assertNull(WatchNextPlan.card(type = "Movie!", meta = "tt1", video = "tt1", title = "Film"))
        assertNotNull(WatchNextPlan.card(type = "movie", meta = "tt1", video = "tt1", title = "Film"))
    }

    @Test
    fun putsNewTitlesOnTheRowAndTakesOffThoseThatLeft() {
        val rows =
            listOf(
                WatchNextRow(id = 1, key = "tt1", browsable = true, watchedAt = 900),
                WatchNextRow(id = 2, key = "tt2", browsable = true, watchedAt = 800),
            )
        val changes = WatchNextPlan.plan(listOf(film("tt1"), film("tt3")), rows)
        assertEquals(
            listOf(
                WatchNextChange.Delete(2),
                WatchNextChange.Update(1, film("tt1")),
                WatchNextChange.Insert(film("tt3")),
            ),
            changes,
        )
    }

    @Test
    fun anEmptyListEmptiesTheRow() {
        val rows =
            listOf(
                WatchNextRow(id = 1, key = "tt1", browsable = true, watchedAt = 900),
                WatchNextRow(id = 2, key = "tt2", browsable = false, watchedAt = 800),
            )
        assertEquals(
            listOf(WatchNextChange.Delete(1), WatchNextChange.Delete(2)),
            WatchNextPlan.plan(emptyList(), rows),
        )
    }

    @Test
    fun writesOnlyWhatChangedSinceItLastWrote() {
        val rows = listOf(WatchNextRow(id = 1, key = "tt1", browsable = true, watchedAt = 1000))
        val unchanged = WatchNextPlan.plan(listOf(film("tt1")), rows, mapOf(1L to film("tt1")))
        assertEquals(emptyList<WatchNextChange>(), unchanged)
        val moved = film("tt1", watchedAt = 2000, position = 700.0)
        assertEquals(
            listOf(WatchNextChange.Update(1, moved)),
            WatchNextPlan.plan(listOf(moved), rows, mapOf(1L to film("tt1"))),
        )
    }

    @Test
    fun aCardThePersonTookOffComesBackOnlyOnceTheyWatchAgain() {
        val removed = listOf(WatchNextRow(id = 5, key = "tt1", browsable = false, watchedAt = 1000))
        assertEquals(emptyList<WatchNextChange>(), WatchNextPlan.plan(listOf(film("tt1", watchedAt = 1000)), removed))
        val again = film("tt1", watchedAt = 5000)
        assertEquals(
            listOf(WatchNextChange.Delete(5), WatchNextChange.Insert(again)),
            WatchNextPlan.plan(listOf(again), removed),
        )
    }

    @Test
    fun clearsUpRowsItCannotPlaceAndKeepsOneCardPerTitle() {
        val rows =
            listOf(
                WatchNextRow(id = 1, key = null, browsable = true, watchedAt = 0),
                WatchNextRow(id = 2, key = "tt1", browsable = true, watchedAt = 900),
                WatchNextRow(id = 3, key = "tt1", browsable = true, watchedAt = 900),
            )
        assertEquals(
            listOf(
                WatchNextChange.Delete(1),
                WatchNextChange.Delete(3),
                WatchNextChange.Update(2, film("tt1")),
            ),
            WatchNextPlan.plan(listOf(film("tt1"), film("tt1", watchedAt = 5)), rows),
        )
    }

    @Test
    fun takesNoMoreCardsThanTheRowNeeds() {
        val cards = (1..40).map { film("tt$it") }
        val changes = WatchNextPlan.plan(cards, emptyList())
        assertEquals(WatchNextPlan.MAX_CARDS, changes.size)
    }
}
