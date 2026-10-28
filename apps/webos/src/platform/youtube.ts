import { isWebOS, lunaCall } from './webos';

/** LG's YouTube app. Every LG TV since webOS 3 ships it. */
export const YOUTUBE_APP_ID = 'youtube.leanback.v4';

/** Fired off the TV instead of launching YouTube, so tests and the dev build can see it. */
export const TRAILER_EVENT = 'bannertv:trailer';

/**
 * Plays a trailer in the TV's own YouTube app, which is light on 2020 TVs
 * and needs no player of ours. Back in YouTube returns to BannerTV. The
 * YouTube app reads the video from `contentTarget`; `contentId` is the form
 * LG's own launcher uses, sent too in case the app version prefers it.
 */
export function playTrailer(youtubeId: string): Promise<void> {
  if (!isWebOS()) {
    window.dispatchEvent(new CustomEvent(TRAILER_EVENT, { detail: youtubeId }));
    return Promise.resolve();
  }
  return lunaCall('luna://com.webos.applicationManager/launch', {
    id: YOUTUBE_APP_ID,
    params: { contentTarget: `v=${youtubeId}`, contentId: youtubeId },
  }).then(() => undefined);
}
