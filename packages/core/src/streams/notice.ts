import type { Stream } from '@bannertv/protocol';
import type { StreamFacts } from './types';

/**
 * Some addons answer with a message dressed up as a stream when they have
 * nothing to play: "Streams temporarily unavailable - try again shortly",
 * "Please reinstall the addon". Its link is a web page or nothing at all, so
 * playing it only ends in a player error that blames the TV or the phone.
 * These rules spot such a notice, so auto-play passes it by and the problem
 * box says what the addon said. Pure, so every screen treats it alike.
 *
 * The rules stay narrow, so a real stream is never hidden: the stream says
 * nothing about a video file (no resolution, codec, size, file type, release
 * or cache mark), and either its link is the addon's settings page or its
 * headline reads as a notice. Only the headline counts (its name and the
 * first line of its description), as a tip further down a real stream's
 * description ("if it buffers, try again later") must not hide it.
 */

/** Wording addons use for "there is nothing to play here". Each part names what is missing. */
const NOTICE = new RegExp(
  [
    // "Streams temporarily unavailable", "Service currently down".
    '\\b(?:temporarily|currently) (?:unavailable|offline|down|not available)\\b',
    // "Streams are not available yet", "Link unavailable", "Source offline".
    '\\b(?:streams?|links?|sources?) (?:are |is )?(?:not (?:yet )?available|unavailable|offline)\\b',
    // "No streams found", "No links available", "No more sources".
    '\\bno (?:(?:more|live|working|available|other) )?(?:streams?|links?|sources?)\\b',
    // The free Sports Streams link: "Please reinstall the addon".
    '\\breinstall\\b',
    '\\bnew add-?on link\\b',
    '\\b(?:install|configure|update|set up) (?:the |this |your |our )?(?:add-?on|manifest)\\b',
    '\\b(?:private )?manifest required\\b',
    '\\b(?:subscription|membership|trial|account|api key|token|link) (?:has |is )?(?:expired|ended|inactive|invalid)\\b',
    '\\b(?:check back|coming) soon\\b',
  ].join('|'),
  'i',
);

/** A link the TV could not take for a video file at all: the addon's own settings page. */
const SETTINGS_PAGE = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]+(?:\/[^?#]*)?\/configure\/?(?:[?#]|$)/i;

/** Links inside an addon's words: only the host is kept, as the path can carry the viewer's keys. */
const LINK = /\b[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi;

/** As long as a problem box line can be: the start of a longer message says what matters. */
export const NOTICE_MAX = 200;

/**
 * Whether the facts say anything at all about a video file. A file name counts through what it
 * tells (its type, size or release): some addons give every stream one, even a message.
 */
function describesVideo(stream: Stream, facts: StreamFacts): boolean {
  return (
    facts.resolution !== undefined ||
    facts.videoCodec !== undefined ||
    facts.hdr.length > 0 ||
    facts.audio.length > 0 ||
    facts.sizeBytes !== undefined ||
    facts.seeders !== undefined ||
    facts.cached !== undefined ||
    facts.container !== undefined ||
    facts.releaseSource !== undefined ||
    facts.releaseGroup !== undefined ||
    stream.behaviorHints.videoSize !== undefined
  );
}

function linesOf(text: string | undefined): string[] {
  return (text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** Whether a stream is an addon's message rather than a video. */
export function isNoticeStream(stream: Stream, facts: StreamFacts): boolean {
  if (stream.source.kind !== 'url' || describesVideo(stream, facts)) return false;
  if (SETTINGS_PAGE.test(stream.source.url)) return true;
  const headline = linesOf(stream.name).concat(linesOf(stream.description).slice(0, 1));
  return headline.some((line) => NOTICE.test(line));
}

function hostOnly(link: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/?#@\s]*@)?([^/?#:\s]+)/i.exec(link);
  return match ? match[1]! : '';
}

/** Cuts text to `max` characters at a space, so no word (or key) is shown in part. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?·-]+$/, '')}…`;
}

/**
 * What a notice says, as one plain sentence or a few: its description, after
 * its name when the name is part of the message (an addon's name tag such as
 * "Sports Streams" is not). Lines that wrap one sentence are joined with a
 * space, separate lines with a full stop. Links keep only their host.
 */
export function noticeText(stream: Stream): string {
  const description = linesOf(stream.description);
  const name = linesOf(stream.name);
  const nameSays = description.length === 0 || name.some((line) => NOTICE.test(line));
  const lines = (nameSays ? name : []).concat(description);
  let text = '';
  const seen: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(LINK, hostOnly).replace(/\s+/g, ' ').trim();
    const key = line.toLowerCase();
    if (line === '' || seen.indexOf(key) >= 0) continue;
    seen.push(key);
    if (text === '') text = line;
    // A line that carries on the sentence before it starts in lower case.
    else if (/[.!?…:]$/.test(text) || /^[a-z]/.test(line)) text = `${text} ${line}`;
    else text = `${text}. ${line}`;
  }
  return clip(text, NOTICE_MAX);
}
