import { describe, expect, it } from 'vitest';
import {
  addonLinks,
  dropAddonLink,
  holdAddonLink,
  type LinkPlace,
  linkStep,
  readAddonLink,
  takeAddonLink,
} from './addon-links';

describe('readAddonLink', () => {
  it('reads a stremio:// install link as its https address', () => {
    expect(readAddonLink('stremio://torrentio.example/providers=a,b|key=x/manifest.json')).toBe(
      'https://torrentio.example/providers=a,b|key=x/manifest.json',
    );
    // A link without the manifest's name still means the manifest.
    expect(readAddonLink('stremio://addon.example/abc')).toBe(
      'https://addon.example/abc/manifest.json',
    );
  });

  it('finds the address in what a browser shares, the page title included', () => {
    expect(readAddonLink('Cool addon\nhttps://addon.example/conf/manifest.json')).toBe(
      'https://addon.example/conf/manifest.json',
    );
    expect(readAddonLink('Try https://addon.example/manifest.json, it is good.')).toBe(
      'https://addon.example/manifest.json',
    );
    expect(readAddonLink('(stremio://addon.example/x/manifest.json).')).toBe(
      'https://addon.example/x/manifest.json',
    );
    expect(readAddonLink('https://addon.example/manifest.json?ref=share')).toBe(
      'https://addon.example/manifest.json',
    );
    // A home-network addon keeps its plain http.
    expect(readAddonLink('http://192.168.1.20:7000/manifest.json')).toBe(
      'http://192.168.1.20:7000/manifest.json',
    );
  });

  it('takes no ordinary web page, nor text without a link', () => {
    expect(readAddonLink('https://addon.example/configure')).toBeUndefined();
    expect(readAddonLink('https://news.example/manifest.json.html')).toBeUndefined();
    expect(readAddonLink('just some words')).toBeUndefined();
    expect(readAddonLink('')).toBeUndefined();
    expect(readAddonLink(`https://addon.example/${'x'.repeat(9000)}/manifest.json`)).toBe(
      undefined,
    );
  });
});

describe('the link waiting', () => {
  it('holds the latest link until it is taken, and only an addon link', () => {
    expect(holdAddonLink('nothing here')).toBe(false);
    expect(addonLinks.get()).toBeNull();
    expect(holdAddonLink('stremio://one.example/manifest.json')).toBe(true);
    const first = addonLinks.get();
    expect(holdAddonLink('stremio://two.example/manifest.json')).toBe(true);
    expect(addonLinks.get()).not.toBe(first);
    expect(takeAddonLink()).toBe('https://two.example/manifest.json');
    expect(takeAddonLink()).toBeUndefined();
    holdAddonLink('stremio://three.example/manifest.json');
    dropAddonLink();
    expect(takeAddonLink()).toBeUndefined();
  });

  it('a new arrival of the same link is news again', () => {
    holdAddonLink('stremio://one.example/manifest.json');
    const first = addonLinks.get();
    holdAddonLink('stremio://one.example/manifest.json');
    expect(addonLinks.get()).not.toBe(first);
    dropAddonLink();
  });
});

describe('linkStep', () => {
  const grownUp: LinkPlace = { welcomed: true, profileId: 'main', kids: false, screen: 'home' };

  it('waits for the welcome and for someone to be chosen', () => {
    expect(linkStep({ ...grownUp, welcomed: false })).toBe('wait');
    expect(linkStep({ ...grownUp, profileId: null })).toBe('wait');
  });

  it('drops the link for a kids profile, and opens Addons for a grown-up', () => {
    expect(linkStep({ ...grownUp, profileId: 'kid001', kids: true })).toBe('drop');
    expect(linkStep(grownUp)).toBe('open');
    expect(linkStep({ ...grownUp, screen: 'player' })).toBe('open');
    expect(linkStep({ ...grownUp, screen: 'addons' })).toBe('here');
  });
});
