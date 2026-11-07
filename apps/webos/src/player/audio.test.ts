import {
  assessStream,
  describeStream,
  type StreamEntry,
  type TvCapabilities,
} from '@bannertv/core';
import { parseStream } from '@bannertv/protocol';
import type { MediaPlaylist } from 'hls.js';
import { describe, expect, it } from 'vitest';
import {
  audioDetail,
  audioSummary,
  audioSwitch,
  channelName,
  formatName,
  hasLanguage,
  isCommentary,
  pickAudio,
} from './audio';
import { hlsAudioTrack } from './engines/hls';
import { shakaAudioId, shakaAudioTrack } from './engines/shaka';
import type { EngineTrack } from './engines/types';

const track = (id: string, lang: string, label: string, extra: Partial<EngineTrack> = {}) => ({
  id,
  lang,
  label,
  active: false,
  ...extra,
});

describe('channelName and formatName', () => {
  it('names channel counts as boxes do', () => {
    expect([1, 2, 6, 8].map((count) => channelName(count))).toEqual(['1.0', '2.0', '5.1', '7.1']);
    expect(channelName('6')).toBe('5.1');
    expect(channelName('16/JOC')).toBeUndefined();
    expect(channelName(3)).toBeUndefined();
    expect(channelName(null)).toBeUndefined();
    expect(channelName('')).toBeUndefined();
  });

  it('names codecs as boxes do, the video codec in a variant list aside', () => {
    expect(formatName('mp4a.40.2')).toBe('AAC');
    expect(formatName('avc1.640028,mp4a.40.5')).toBe('AAC');
    expect(formatName('ec-3')).toBe('DD+');
    expect(formatName('ec-3', true)).toBe('Atmos');
    expect(formatName('ac-3')).toBe('DD');
    expect(formatName('opus')).toBe('Opus');
    expect(formatName('dtsc')).toBe('DTS');
    expect(formatName('fLaC')).toBe('FLAC');
    expect(formatName('mp4a.40.34')).toBe('MP3');
    expect(formatName('vp09.00.10.08')).toBeUndefined();
    expect(formatName(null)).toBeUndefined();
    expect(formatName(undefined, true)).toBe('Atmos');
  });

  it('reads the MP4 object-type names for Dolby, DTS and MP3, and leaves other mp4a codes unnamed', () => {
    expect(formatName('mp4a.a6')).toBe('DD+');
    expect(formatName('mp4a.a6', true)).toBe('Atmos');
    expect(formatName('mp4a.a5')).toBe('DD');
    expect(formatName('mp4a.a9')).toBe('DTS');
    expect(formatName('mp4a.69')).toBe('MP3');
    expect(formatName('mp4a.40.29')).toBe('AAC');
    expect(formatName('mp4a.67')).toBe('AAC');
    expect(formatName('mp4a.e1')).toBeUndefined();
  });
});

describe('audio rows', () => {
  it('reads "English 5.1" on the tab, and the format and the track’s own name beside it', () => {
    const main = track('1', 'eng', 'English', { channels: '5.1', format: 'DD+' });
    expect(audioSummary(main)).toBe('English 5.1');
    expect(audioDetail(main)).toBe('DD+ 5.1');
    const named = track('2', 'eng', "Director's commentary", { channels: '2.0' });
    expect(audioDetail(named)).toBe("2.0 · Director's commentary");
    // The TV's own player gives a language and the name inside the file, nothing more.
    expect(audioSummary(track('0', 'en', ''))).toBe('English');
    expect(audioDetail(track('0', 'en', ''))).toBeUndefined();
    expect(audioDetail(track('0', 'eng', 'eng'))).toBeUndefined();
    expect(audioSummary(track('0', '', 'Main'))).toBe('Main');
    // Neither: never a bare "?".
    expect(audioSummary(track('0', '', ''))).toBe('Unknown language');
    expect(audioSummary(track('0', '', '', { channels: '2.0' }))).toBe('Unknown language 2.0');
    expect(audioSummary(track('0', 'und', ''))).toBe('Unknown language');
  });

  it('knows a commentary by its mark or its name', () => {
    expect(isCommentary(track('1', 'eng', 'English', { commentary: true }))).toBe(true);
    expect(isCommentary(track('1', 'eng', 'Commentary with the director'))).toBe(true);
    expect(isCommentary(track('1', 'ger', 'Kommentar'))).toBe(true);
    expect(isCommentary(track('1', 'eng', 'English'))).toBe(false);
    expect(isCommentary(track('1', 'eng', 'No Commentary'))).toBe(false);
    expect(isCommentary(track('1', 'eng', 'English (without the commentary)'))).toBe(false);
    expect(isCommentary(track('1', 'eng', "Without Director's Commentary"))).toBe(false);
    expect(isCommentary(track('1', 'eng', 'English, without the director commentary'))).toBe(false);
    expect(isCommentary(track('1', 'eng', 'Non-Commentary'))).toBe(false);
    expect(isCommentary(track('1', 'eng', "Nolan's commentary"))).toBe(true);
    expect(isCommentary(track('1', 'ger', 'Kein Kommentar'))).toBe(false);
    expect(isCommentary(track('1', 'ger', 'ohne Audiokommentar'))).toBe(false);
    expect(isCommentary(track('1', 'eng', 'No Country for Old Men Commentary'))).toBe(true);
    expect(isCommentary(track('1', 'eng', 'Without Remorse commentary'))).toBe(true);
    // Where names are not trusted, only the stream's mark counts.
    expect(isCommentary(track('1', 'eng', 'English Commentary'), false)).toBe(false);
    expect(isCommentary(track('1', 'eng', 'Main', { commentary: true }), false)).toBe(true);
  });
});

describe('pickAudio', () => {
  it('keeps the track playing when it is in the language wanted and not a commentary', () => {
    const tracks = [
      track('1', 'eng', 'English'),
      track('2', 'en', 'English', { active: true, channels: '5.1' }),
    ];
    expect(pickAudio(tracks, 'eng')?.id).toBe('2');
  });

  it('passes over a commentary listed first', () => {
    const tracks = [
      track('0', 'fre', 'French', { active: true }),
      track('1', 'eng', 'Commentary'),
      track('2', 'eng', 'English'),
    ];
    expect(pickAudio(tracks, 'en')?.id).toBe('2');
    const playing = [track('1', 'eng', 'Commentary', { active: true }), track('2', 'eng', 'Main')];
    expect(pickAudio(playing, 'eng')?.id).toBe('2');
  });

  it('takes a commentary only when it is all the language has, and nothing in another', () => {
    expect(pickAudio([track('1', 'eng', 'Commentary')], 'eng')?.id).toBe('1');
    expect(pickAudio([track('1', 'fre', 'French'), track('2', '', 'Main')], 'eng')).toBeUndefined();
    // Every one a commentary: the one playing stays.
    const all = [
      track('1', 'eng', 'Commentary 1'),
      track('2', 'eng', 'Commentary 2', { active: true }),
    ];
    expect(pickAudio(all, 'eng')?.id).toBe('2');
    // "No Commentary" is the main sound.
    const without = [
      track('1', 'eng', 'No Commentary'),
      track('2', 'eng', 'English Commentary', { active: true }),
    ];
    expect(pickAudio(without, 'eng')?.id).toBe('1');
  });

  it('keeps sport’s “commentary”, the main sound, when names are not to be trusted', () => {
    const sport = [
      track('1', 'en', 'English Commentary', { active: true }),
      track('2', 'en', 'Stadium sound'),
    ];
    expect(pickAudio(sport, 'eng', false)?.id).toBe('1');
    expect(pickAudio(sport, 'eng')?.id).toBe('2');
  });
});

describe('engine audio tracks', () => {
  it('reads channels and format from an HLS rendition, Atmos included', () => {
    const playlist = (extra: Partial<MediaPlaylist>) =>
      ({ lang: 'eng', name: 'English', ...extra }) as MediaPlaylist;
    expect(hlsAudioTrack(playlist({ channels: '6', audioCodec: 'ec-3' }), true)).toEqual({
      id: 'eng|English',
      lang: 'eng',
      label: 'English',
      active: true,
      channels: '5.1',
      format: 'DD+',
    });
    expect(hlsAudioTrack(playlist({ channels: '16/JOC', audioCodec: 'ec-3' }), false)).toEqual({
      id: 'eng|English',
      lang: 'eng',
      label: 'English',
      active: false,
      format: 'Atmos',
    });
    // The group's whole list says nothing of this rendition's own codec.
    expect(
      hlsAudioTrack(playlist({ audioCodec: 'mp4a.40.2,ec-3', channels: '16/JOC' }), false).format,
    ).toBe('Atmos');
    expect(
      hlsAudioTrack(playlist({ audioCodec: 'mp4a.40.2,ec-3', channels: '2' }), false).format,
    ).toBeUndefined();
    // HE-AAC and AAC-LC renditions in one group are AAC either way.
    expect(
      hlsAudioTrack(playlist({ audioCodec: 'mp4a.40.5,mp4a.40.2', channels: '2' }), false).format,
    ).toBe('AAC');
    expect(hlsAudioTrack(playlist({ lang: undefined }), false)).toEqual({
      id: '|English',
      lang: '',
      label: 'English',
      active: false,
    });
  });

  it('gives a Shaka track an id from what it is, and reads its channels, format and role', () => {
    const shaka = {
      active: false,
      language: 'en',
      label: null,
      roles: ['commentary'],
      channelsCount: 2,
      codecs: 'mp4a.40.2',
      spatialAudio: false,
    } as unknown as Parameters<typeof shakaAudioTrack>[0];
    const listed = shakaAudioTrack(shaka);
    expect(listed).toEqual({
      id: shakaAudioId(shaka),
      lang: 'en',
      label: '',
      active: false,
      channels: '2.0',
      format: 'AAC',
      commentary: true,
    });
    const surround = { ...shaka, roles: ['main'], channelsCount: 6, codecs: 'ec-3' };
    expect(shakaAudioId(surround)).not.toBe(listed.id);
    expect(shakaAudioTrack({ ...surround, spatialAudio: true }).format).toBe('Atmos');
    // HE-AAC listed, AAC-LC playing: one track, the same id either way.
    expect(shakaAudioId({ ...shaka, codecs: 'mp4a.40.5' })).toBe(
      shakaAudioId({ ...shaka, codecs: 'mp4a.40.2' }),
    );
    // Any codec by its family, as Shaka groups it, and two families stay two.
    expect(shakaAudioId({ ...surround, codecs: 'ac-4.02.01.01' })).toBe(
      shakaAudioId({ ...surround, codecs: 'ac-4.02.01.02' }),
    );
    expect(shakaAudioTrack({ ...surround, codecs: 'ac-4.02.01.01' }).format).toBe('AC-4');
    expect(shakaAudioTrack({ ...shaka, codecs: 'mp4a.40' }).format).toBe('AAC');
    expect(shakaAudioId({ ...surround, codecs: 'dtsc' })).not.toBe(
      shakaAudioId({ ...surround, codecs: 'dtse' }),
    );
  });
});

describe('the Audio tab offering a stream in another language', () => {
  const TV: TvCapabilities = {
    webOS: 22,
    uhd: true,
    hdr10: true,
    dolbyVision: false,
    hevc: true,
    av1: true,
    dts: false,
    truehd: false,
  };
  const stream = (file: string, title: string, rank: number): StreamEntry => {
    const parsed = parseStream({
      url: `https://cdn.example.org/${file}.mkv`,
      name: 'Addon\n1080p',
      title,
    })!;
    const facts = describeStream(parsed);
    return {
      stream: parsed,
      addonId: 'addon',
      addonRank: 0,
      rank,
      facts,
      assessment: assessStream(parsed, facts, TV),
    };
  };
  const dub = stream('dub', 'Film.1080p.WEB-DL 🇪🇸', 0);
  const original = stream('original', 'Film.1080p.WEB-DL', 1);

  it('tells whether the tracks have the language, by any of its codes', () => {
    expect(hasLanguage([track('1', 'spa', ''), track('2', 'en-GB', '')], 'eng')).toBe(true);
    expect(hasLanguage([track('1', 'es', '')], 'en')).toBe(false);
    expect(hasLanguage([track('1', '', 'Track 1'), track('2', 'und', '')], 'en')).toBeUndefined();
  });

  it('offers a stream in the language when what plays has none', () => {
    const candidates = [dub, original];
    expect(audioSwitch([track('1', 'spa', '')], { entry: dub }, candidates, 'en')).toBe(original);
    // Tracks that don't say: the stream's own name tells.
    expect(audioSwitch([], { entry: dub }, candidates, 'en')).toBe(original);
    expect(audioSwitch([], { entry: original }, candidates, 'en')).toBeUndefined();
  });

  it('offers nothing when the language plays, or no other stream has it', () => {
    expect(
      audioSwitch([track('1', 'eng', '')], { entry: dub }, [dub, original], 'en'),
    ).toBeUndefined();
    expect(audioSwitch([track('1', 'spa', '')], { entry: dub }, [dub], 'en')).toBeUndefined();
  });
});
