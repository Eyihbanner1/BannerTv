import { createStore, type Store } from '@bannertv/core';
import { VideoView, type VideoViewProps } from 'expo-video';
import { type RefObject, useEffect, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, Text, type TextStyle, View } from 'react-native';
import { pictureSize } from './phone-host';
import {
  ASSUMED_VIDEO,
  type PictureFrame,
  pictureLayout,
  pictureNote,
  shownShape,
  type Size,
  videoSizeOf,
} from './picture-fit';

/**
 * What the picture is drawn from that changes faster than the whole player screen should draw:
 * the frame while two fingers move it, the screen's size and the picture's own. The player
 * screen writes the frame as the fingers move and keeps it once they lift; only the picture and
 * its note draw again at each move.
 */
export interface PictureNow {
  /** The frame while two fingers are on the picture; null otherwise, and the title's shows. */
  moving: PictureFrame | null;
  /** The screen's size in points, once it has been measured. */
  screen: Size | null;
  /** The picture's own shape as it shows (shownShape), once its player has said. */
  video: Size | null;
}

export function pictureNow(): Store<PictureNow> {
  return createStore<PictureNow>({ moving: null, screen: null, video: null });
}

function sameSize(a: Size | null, b: Size | null): boolean {
  return a === b || (!!a && !!b && a.width === b.width && a.height === b.height);
}

/** The screen's size, measured as the player screen is laid out. */
export function noteScreen(now: Store<PictureNow>, screen: Size): void {
  now.set((was) => (sameSize(was.screen, screen) ? was : { ...was, screen }));
}

/** The part of the web build's <video> element read for its size. */
interface WebVideo {
  videoWidth: number;
  videoHeight: number;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/** On the web build, VideoView's nativeRef is the <video> element itself; elsewhere null. */
function webVideo(view: VideoView | null): WebVideo | null {
  const element = (view as { nativeRef?: { current?: unknown } } | null)?.nativeRef?.current as
    Partial<WebVideo> | null | undefined;
  return element &&
    typeof element.addEventListener === 'function' &&
    typeof element.videoWidth === 'number'
    ? (element as WebVideo)
    : null;
}

/** When a <video> element learns its size, or loses it with its stream. */
const SIZE_EVENTS = ['loadedmetadata', 'resize', 'emptied'];

/**
 * The picture's own shape into `now`: from Android's player (phone-host.ts), by the size it is
 * stored at, which shownShape turns into the shape it shows at (`live` for live sport and live
 * channels); or on the web build, whose player knows no tracks, from the <video> element, which
 * gives the shape it shows at.
 */
function useVideoSize(
  now: Store<PictureNow>,
  viewRef: RefObject<VideoView | null>,
  live: boolean,
): void {
  useEffect(() => {
    const note = (video: Size | null) =>
      now.set((was) => (sameSize(was.video, video) ? was : { ...was, video }));
    if (Platform.OS !== 'web') {
      const read = () => {
        const stored = pictureSize.get();
        note(stored && shownShape(stored, live));
      };
      read();
      return pictureSize.subscribe(read);
    }
    const element = webVideo(viewRef.current);
    if (!element) return;
    const read = () => note(videoSizeOf(element.videoWidth, element.videoHeight));
    read();
    for (const type of SIZE_EVENTS) element.addEventListener(type, read);
    return () => {
      for (const type of SIZE_EVENTS) element.removeEventListener(type, read);
    };
  }, [now, viewRef, live]);
}

/**
 * The picture: Android's player (or the web build's <video>), sized and placed as `kept` says,
 * or as the fingers have it while they move it. Laid out, never scaled (picture-fit.ts says why),
 * and clipped to the screen, which shows the part of it on the screen.
 *
 * In picture-in-picture's small window it shows whole, whatever its size and place. Only how the
 * picture fills its view changes then, not the view's place: Android takes the player out of the
 * view into the small window, lays it out there itself, and puts it back as the window closes.
 * The view, still where it was, takes it back as it was, with no jump from the whole picture.
 */
export function Picture({
  now,
  kept,
  pip,
  live,
  viewRef,
  ...video
}: {
  now: Store<PictureNow>;
  kept: PictureFrame;
  pip: boolean;
  /** Live sport or a live channel, whose squeezed HD sizes show at 16:9 (shownShape). */
  live: boolean;
  viewRef: RefObject<VideoView | null>;
} & Omit<VideoViewProps, 'style' | 'contentFit'>) {
  const { moving, screen, video: size } = useSyncExternalStore(now.subscribe, now.get);
  useVideoSize(now, viewRef, live);
  const layout = pictureLayout(moving ?? kept, screen, size);
  return (
    <View style={styles.clip}>
      <VideoView
        ref={viewRef}
        {...video}
        style={layout.rect ? [styles.placed, layout.rect] : styles.whole}
        contentFit={pip ? 'contain' : layout.contentFit}
      />
    </View>
  );
}

/**
 * The note while the picture changes: "Fit to screen", "Zoomed to fill", or how big it is
 * between and beyond, as a share of the whole picture. Once it overhangs, a second line says two
 * fingers move it.
 */
export function PictureNote({
  now,
  kept,
  textStyle,
  hintStyle,
}: {
  now: Store<PictureNow>;
  kept: PictureFrame;
  textStyle: TextStyle;
  hintStyle: TextStyle;
}) {
  const { t } = useTranslation();
  const { moving, screen, video } = useSyncExternalStore(now.subscribe, now.get);
  const note = pictureNote(moving ?? kept, screen, video ?? ASSUMED_VIDEO);
  const words =
    note.kind === 'fit'
      ? t('phone.fitToScreen')
      : note.kind === 'fill'
        ? t('phone.zoomedToFill')
        : t('phone.zoomedTo', { percent: note.percent });
  return (
    <>
      <Text style={textStyle}>{words}</Text>
      {note.kind === 'fit' ? null : <Text style={hintStyle}>{t('phone.pictureMoves')}</Text>}
    </>
  );
}

const styles = StyleSheet.create({
  clip: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  // Sized as well as placed: the web build draws a <video>, which keeps its own size otherwise.
  whole: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  placed: { position: 'absolute' },
});
