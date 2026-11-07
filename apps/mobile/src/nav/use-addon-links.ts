import { activeProfileId, isKidsProfile } from '@tv/data/profiles';
import { welcomed } from '@tv/data/welcome';
import { requireOptionalNativeModule } from 'expo';
import { router } from 'expo-router';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { whereabouts } from '../runtime/whereabouts';
import { type AddonLink, addonLinks, dropAddonLink, holdAddonLink, linkStep } from './addon-links';

/** modules/banner-share: text another app shared with BannerTV. */
interface ShareModule {
  takeLaunchText(): string | null;
  addListener(event: 'shared', listener: (event: { text: string }) => void): { remove(): void };
}

let listening = false;

/** Holds addon links shared to BannerTV: the one that started the app, then any later. Once. */
function listenForShares(): void {
  if (listening) return;
  listening = true;
  const share = requireOptionalNativeModule<ShareModule>('BannerShare');
  if (!share) return;
  const first = share.takeLaunchText();
  if (first) holdAddonLink(first);
  share.addListener('shared', ({ text }) => holdAddonLink(text));
}

/**
 * Opens Addons for an addon link that came from outside the app (+native-intent.ts holds
 * stremio:// links, banner-share holds shares), once a grown-up profile is in use: the link
 * waits through the welcome and "Who's watching?", and a kids profile drops it. The Addons
 * screen takes the link itself and asks before adding. Mounted once, under every screen.
 */
export function useAddonLinks(): void {
  const waiting = useSyncExternalStore(addonLinks.subscribe, addonLinks.get);
  const profileId = useSyncExternalStore(activeProfileId.subscribe, activeProfileId.get);
  const welcomeDone = useSyncExternalStore(welcomed.subscribe, welcomed.get);
  const { screen } = useSyncExternalStore(whereabouts.subscribe, whereabouts.get);
  // Addons opens once for each link, even while it mounts and before it takes the link.
  const opened = useRef<AddonLink | null>(null);

  useEffect(listenForShares, []);

  useEffect(() => {
    if (waiting === null || opened.current === waiting) return;
    const step = linkStep({ welcomed: welcomeDone, profileId, kids: isKidsProfile(), screen });
    if (step === 'drop') dropAddonLink();
    if (step !== 'open') return;
    opened.current = waiting;
    router.push('/addons');
  }, [waiting, profileId, welcomeDone, screen]);
}
