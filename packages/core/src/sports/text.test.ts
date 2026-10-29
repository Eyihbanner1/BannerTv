import { describe, expect, it } from 'vitest';
import { isSportLabel, liveWindow, sportOf } from './sport';
import {
  artworkCompetition,
  cleanTitle,
  competitionLine,
  foldText,
  isLiveLabel,
  readSide,
  sequenceNumber,
  slugOf,
  sofascoreTournament,
  splitTeams,
  stripDecorations,
  teamKey,
} from './text';

describe('team names', () => {
  it('folds accents and the letters NFD leaves alone', () => {
    expect(foldText('Bayern München')).toBe('bayern munchen');
    expect(foldText('Bodø/Glimt')).toBe('bodo/glimt');
    expect(foldText('Łódź')).toBe('lodz');
    expect(foldText('Fenerbahçe')).toBe('fenerbahce');
    expect(foldText('Beşiktaş')).toBe('besiktas');
    expect(foldText('Straße')).toBe('strasse');
  });

  it('takes off flags, emoji and tag characters', () => {
    expect(stripDecorations('🏴󠁧󠁢󠁥󠁮󠁧󠁿 Premier League').trim()).toBe('Premier League');
    expect(stripDecorations('⚽ Football 🔴').trim()).toBe('Football');
    expect(stripDecorations('🇩🇪 Bundesliga').trim()).toBe('Bundesliga');
  });

  it('matches the usual spellings of one club', () => {
    expect(teamKey('Manchester Utd')).toBe(teamKey('Manchester United FC'));
    expect(teamKey('Brighton & Hove Albion')).toBe(teamKey('Brighton and Hove Albion'));
    expect(teamKey('St Mirren')).toBe(teamKey('Saint Mirren'));
    expect(teamKey('FC Bayern München')).toBe(teamKey('Bayern Munchen'));
    expect(teamKey('1. FC Köln')).toBe(teamKey('FC Koln'));
    expect(teamKey('Hannover 96')).not.toBe('');
  });

  it('reads youth, reserve and women marks', () => {
    expect(readSide('Manchester United U18').marks.youth).toBe(true);
    expect(readSide('Arsenal U21').marks.youth).toBe(true);
    expect(readSide('Jeddeloh II').marks.reserve).toBe(true);
    expect(readSide('Chelsea Women').marks.women).toBe(true);
    expect(readSide('Chelsea').marks).toEqual({ youth: false, reserve: false, women: false });
    expect(teamKey(readSide('Manchester United U18').base)).toBe(teamKey('Manchester United'));
  });
});

describe('titles', () => {
  it('takes live markers, clocks and scores off a name', () => {
    expect(cleanTitle('🔴 LIVE: Los Angeles Lakers vs Portland Trail Blazers')).toMatchObject({
      title: 'Los Angeles Lakers vs Portland Trail Blazers',
      live: true,
    });
    const clocked = cleanTitle('⏰ 19:45 - 27/10 | Celtic vs Rangers');
    expect(clocked.title).toBe('Celtic vs Rangers');
    expect(clocked.clock).toMatchObject({ hours: 19, minutes: 45, day: 27, month: 10 });
    expect(cleanTitle('Arsenal vs Spurs 2-1').title).toBe('Arsenal vs Spurs');
    expect(cleanTitle('Arsenal vs Spurs (2 - 1)').title).toBe('Arsenal vs Spurs');
    expect(cleanTitle('Liverpool FC vs Chelsea')).toMatchObject({
      title: 'Liverpool FC vs Chelsea',
      live: false,
    });
    expect(cleanTitle('Livingston vs Hearts').title).toBe('Livingston vs Hearts');
    expect(cleanTitle('LIVE NOW: Livingston vs Hearts')).toMatchObject({
      title: 'Livingston vs Hearts',
      live: true,
    });
    expect(cleanTitle('EN VIVO · NHL: San Jose Sharks vs Buffalo Sabres').title).toBe(
      'NHL: San Jose Sharks vs Buffalo Sabres',
    );
  });

  it('keeps a season at the end of a title whole', () => {
    expect(cleanTitle('Lakers vs Celtics - NBA 2025-26').title).toBe(
      'Lakers vs Celtics - NBA 2025-26',
    );
    expect(cleanTitle('Arsenal vs Chelsea - Premier League 2025-26').title).toBe(
      'Arsenal vs Chelsea - Premier League 2025-26',
    );
    expect(splitTeams(cleanTitle('Lakers vs Celtics - NBA 2025-26').title)).toMatchObject({
      away: 'Celtics',
      suffix: 'NBA 2025-26',
    });
  });

  it('knows live labels from times', () => {
    expect(isLiveLabel('LIVE')).toBe(true);
    expect(isLiveLabel('🔴 Live now')).toBe(true);
    expect(isLiveLabel("67'")).toBe(true);
    expect(isLiveLabel('28 Oct 2026 · 17:00 UTC')).toBe(false);
    expect(isLiveLabel(undefined)).toBe(false);
  });
});

describe('splitting teams', () => {
  it('splits on vs, v and vs.', () => {
    expect(splitTeams('Freiburg vs Wolfsburg')).toMatchObject({
      home: 'Freiburg',
      away: 'Wolfsburg',
      separator: 'vs',
    });
    expect(splitTeams('Celtic v Rangers')).toMatchObject({ home: 'Celtic', away: 'Rangers' });
    expect(splitTeams('Celtic vs. Rangers')).toMatchObject({ home: 'Celtic', away: 'Rangers' });
  });

  it('puts the away side second for "at" and "@"', () => {
    expect(splitTeams('Buffalo Bills at Kansas City Chiefs')).toMatchObject({
      home: 'Kansas City Chiefs',
      away: 'Buffalo Bills',
      separator: 'at',
    });
    expect(splitTeams('Bills @ Chiefs')).toMatchObject({ home: 'Chiefs', away: 'Bills' });
  });

  it('splits on a dash only when nothing else matches', () => {
    expect(splitTeams('Celtic - Rangers')).toMatchObject({
      home: 'Celtic',
      away: 'Rangers',
      separator: 'dash',
    });
    expect(splitTeams('South Africa vs Australia - 3rd Test Day 2')).toMatchObject({
      home: 'South Africa',
      away: 'Australia',
      suffix: '3rd Test Day 2',
    });
  });

  it('reads a competition in front of the teams', () => {
    expect(splitTeams('Copa del Rey: Poblense vs Ceuta')).toMatchObject({
      prefix: 'Copa del Rey',
      home: 'Poblense',
      away: 'Ceuta',
    });
    expect(splitTeams('England - League One : Barnsley vs Wigan')).toMatchObject({
      prefix: 'England - League One',
      home: 'Barnsley',
    });
  });

  it('reads a competition that ends in a number, but never a time', () => {
    expect(splitTeams('Ligue 1: Paris Saint-Germain vs Marseille')).toEqual({
      prefix: 'Ligue 1',
      home: 'Paris Saint-Germain',
      away: 'Marseille',
      separator: 'vs',
    });
    expect(splitTeams('K League 1: Ulsan HD vs Jeonbuk Hyundai Motors')).toMatchObject({
      prefix: 'K League 1',
      home: 'Ulsan HD',
    });
    expect(splitTeams('UFC 310: Pantoja vs Asakura')).toMatchObject({
      prefix: 'UFC 310',
      home: 'Pantoja',
    });
    expect(splitTeams('19:45: Celtic vs Rangers')).toEqual({
      home: 'Celtic',
      away: 'Rangers',
      separator: 'vs',
    });
  });

  it('finds no teams where there are none', () => {
    expect(splitTeams('Formula 1: Mexican Grand Prix')).toBeUndefined();
    expect(splitTeams('WTA 500 Tokyo')).toBeUndefined();
    expect(splitTeams('')).toBeUndefined();
    expect(splitTeams(' vs ')).toBeUndefined();
  });

  it('keeps every game or day number', () => {
    expect(sequenceNumber('Dodgers vs Yankees Game 2')).toBe('game2');
    expect(sequenceNumber('South Africa vs Australia - 3rd Test Day 2')).toBe('day2-test3');
    // Two days of one Test are two matches; one day written either way round is one.
    const day1 = sequenceNumber('Bangladesh vs West Indies - 1st Test Day 1');
    const day2 = sequenceNumber('Bangladesh vs West Indies - 1st Test Day 2');
    expect(day1).toBe('day1-test1');
    expect(day2).not.toBe(day1);
    expect(sequenceNumber('Bangladesh vs West Indies - Day 2, 1st Test')).toBe(day2);
    expect(sequenceNumber('Celtic vs Rangers')).toBeUndefined();
    expect(sequenceNumber('Game 1 Game 2 Game 3 '.repeat(300))).toBe('game1-game2-game3');
  });
});

describe('competition hints', () => {
  it('reads a League line from the description', () => {
    expect(competitionLine('🏆 League: Austria Cup\n📅 Category: OTHER')).toBe('Austria Cup');
    expect(competitionLine('Tournament: ATP Paris')).toBe('ATP Paris');
    expect(competitionLine('Live on NOW-34334')).toBeUndefined();
    expect(competitionLine(undefined)).toBeUndefined();
  });

  it('reads a league parameter from artwork, never anything else', () => {
    expect(
      artworkCompetition('https://example.test/img/match?cat=hockey&t1=A&t2=B&lg=NHL&ch=ESPN'),
    ).toBe('NHL');
    expect(artworkCompetition('https://example.test/img/match?lg=English+Premier+League')).toBe(
      'English Premier League',
    );
    expect(artworkCompetition('https://example.test/poster.webp')).toBeUndefined();
    expect(artworkCompetition('not a url %%%')).toBeUndefined();
    expect(sofascoreTournament('https://api.sofascore.app/api/v1/unique-tournament/17/image')).toBe(
      17,
    );
  });

  it('makes slugs safe for focus keys', () => {
    expect(slugOf('streamed:football-freiburg-wolfsburg-20754')).toMatch(/^[a-z0-9-]+$/);
    expect(slugOf('🔴 LIVE: Ä/B')).toMatch(/^[a-z0-9-]*$/);
  });
});

describe('sports', () => {
  it('names the sport from words addons use', () => {
    expect(sportOf('⚽ Soccer')).toBe('football');
    expect(sportOf('FOOTBALL')).toBe('football');
    expect(sportOf('American Football')).toBe('american-football');
    expect(sportOf('College Football')).toBe('american-football');
    expect(sportOf('HOCKEY')).toBe('ice-hockey');
    expect(sportOf('Fight (UFC, Boxing)')).toBe('mma');
    expect(sportOf('F1 & Motor')).toBe('motorsport');
    expect(sportOf('Horse Racing')).toBe('other');
    expect(sportOf('AFL')).toBe('aussie-rules');
    expect(sportOf('Movies')).toBeUndefined();
  });

  it('tells a genre that is only the sport from one that names a competition', () => {
    expect(isSportLabel('Football')).toBe(true);
    expect(isSportLabel('BASKETBALL')).toBe(true);
    expect(isSportLabel('College Football')).toBe(false);
    expect(isSportLabel('NBA')).toBe(false);
    expect(isSportLabel('Copa del Rey')).toBe(false);
  });

  it('keeps football live for 2.5 hours, longer while the addon still says so', () => {
    const hour = 60 * 60 * 1000;
    expect(liveWindow('football', false)).toBe(2.5 * hour);
    expect(liveWindow('football', true)).toBe(3 * hour);
    expect(liveWindow('cricket', false)).toBe(8 * hour);
  });
});
