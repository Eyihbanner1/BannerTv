package com.bannertv.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DeepLinkTest {
    @Test
    fun buildsTheLinkACardOpens() {
        assertEquals(
            "bannertv://open?type=movie&meta=tt1254207&video=tt1254207",
            DeepLink.build(OpenLink("movie", "tt1254207", "tt1254207")),
        )
        assertEquals("bannertv://open?type=movie&meta=tt1", DeepLink.build(OpenLink("movie", "tt1", null)))
    }

    @Test
    fun readsBackWhatItBuilds() {
        for (link in listOf(
            OpenLink("series", "tt0944947", "tt0944947:1:2"),
            OpenLink("series", "kitsu:42", "kitsu:42:7"),
            OpenLink("channel", "yt_id:UCabc", "yt_id:UCabc/Some video & more = fun"),
            OpenLink("movie", "tmdb:603", null),
            OpenLink("movie", "Amélie 2001", "Amélie 2001"),
        )) {
            assertEquals(link, DeepLink.parse(DeepLink.build(link)))
        }
    }

    @Test
    fun readsALinkAsAdbOrAnotherAppWouldSendIt() {
        assertEquals(
            OpenLink("series", "tt8000001", "tt8000001:1:2"),
            DeepLink.parse("bannertv://open?type=series&meta=tt8000001&video=tt8000001:1:2"),
        )
        // The first of a repeated name counts, and names it does not know are passed over.
        assertEquals(
            OpenLink("movie", "tt1", null),
            DeepLink.parse("bannertv://open?type=movie&meta=tt1&meta=tt2&addon=https://x"),
        )
    }

    @Test
    fun refusesWhatIsNotOneOfItsLinks() {
        for (link in listOf(
            null,
            "",
            "https://open?type=movie&meta=tt1",
            "bannertv://play?type=movie&meta=tt1",
            "bannertv://open",
            "bannertv://open?type=movie",
            "bannertv://open?meta=tt1",
            "bannertv://open?type=Movie&meta=tt1",
            "bannertv://open?type=../addons&meta=tt1",
            "bannertv://open?type=movie&meta=",
            "bannertv://open?type=movie&meta=tt1%0A",
            "bannertv://open?type=movie&meta=%E0%A4%A",
            "bannertv://open?type=movie&meta=${"x".repeat(301)}",
            "not a link at all",
        )) {
            assertNull("link $link", DeepLink.parse(link))
        }
    }

    @Test
    fun dropsAVideoIdThatIsNotOne() {
        assertEquals(OpenLink("movie", "tt1", null), DeepLink.parse("bannertv://open?type=movie&meta=tt1&video="))
    }
}
