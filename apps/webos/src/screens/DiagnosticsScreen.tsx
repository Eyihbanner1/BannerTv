import { SPEED_KINDS, type SpeedResults } from '@bannertv/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useScreenFocus } from '../app/use-screen-focus';
import { Button } from '../components/Button';
import { scorecard, speedMemory } from '../data/playback';
import { checkSkipTimings } from '../data/skips';
import {
  collectDiagnostics,
  type DiagnosticRow,
  type DiagnosticSection,
} from '../platform/diagnostics';
import { formatClock } from '../player/media';
import { playRows, scorecardRows } from '../player/scorecard-rows';
import { recentSubtitleTraces, subtitleTraceRows } from '../player/subtitle-trace';
import screenStyles from './Screen.module.css';
import styles from './DiagnosticsScreen.module.css';

// Sections per column, so the whole report fits on one 1920x1080 screen: the TV, the skip
// timings and the newest play's subtitles in the middle, the Lab's speeds under the media.
const COLUMNS = [
  [0, 1],
  [2, 6, 5],
  [3, 4],
];

/** The scorecard page: the averages, then the newest plays across the two columns beside them. */
const PLAYS_COLUMNS = [[0], [1]];

const CHECKING = 'checking…';

/** What the Lab's speed test settled for each kind of stream, and when. */
function speedSection(results: SpeedResults): DiagnosticSection {
  const rows: DiagnosticRow[] = SPEED_KINDS.map((kind) => {
    const result = results[kind];
    if (!result) return [kind, 'not tested'];
    const passed =
      result.rates.length > 0 ? result.rates.map((rate) => `${rate}×`).join(', ') : 'none';
    const when = new Date(result.testedAt);
    const date = `${when.getDate()}/${when.getMonth() + 1} ${formatClock(result.testedAt)}`;
    return [
      kind,
      [passed, result.why, date, result.firmware].filter((part) => part !== undefined).join(' · '),
    ];
  });
  return { title: 'Playback speed (Lab)', rows };
}

/** Plays the scorecard page lists, one line each, so they fit on one 1920x1080 screen. */
const PLAYS_ON_PAGE = 25;

/**
 * The scorecard page: the averages against the targets, then the newest
 * plays, one line each. `all` lists every play kept, for the console.
 */
function scorecardSections(all = false): DiagnosticSection[] {
  const plays = scorecard.plays();
  const listed = all ? plays : plays.slice(0, PLAYS_ON_PAGE);
  const sections: DiagnosticSection[] = [
    { title: 'Playback scorecard', rows: scorecardRows(plays), stacked: true },
  ];
  if (listed.length > 0) {
    sections.push({
      title: listed.length < plays.length ? `Newest ${listed.length} plays` : 'Plays, newest first',
      rows: playRows(listed),
    });
  }
  return sections;
}

/**
 * Plays the Subtitles section shows on screen, newest first. Under a TV's
 * ten rows and the skip timings, its column has room for one, its label
 * starting the row; the console line carries every play kept.
 */
const PLAYS_ON_SCREEN = 1;

/**
 * The subtitles of the last few plays (or of the newest `shown`): whether
 * the video's hash was read, the files in each language, why the version
 * showing was chosen, and how long the first line took. Ids, counts and
 * times only, never a link.
 */
function subtitleSection(shown?: number): DiagnosticSection {
  const plays = recentSubtitleTraces();
  const rows = subtitleTraceRows(shown === undefined ? plays : plays.slice(0, shown));
  return { title: 'Subtitles', rows, stacked: true };
}

/**
 * Spike 1 and the device facts the later spikes need. The report also goes
 * to the console, so `pnpm tv:inspect` can copy it.
 */
export function DiagnosticsScreen() {
  const { t } = useTranslation();
  const [sections, setSections] = useState<DiagnosticSection[] | null>(null);
  // The device report, or how the plays on this screen went (the playback scorecard).
  const [page, setPage] = useState<'device' | 'plays'>('device');
  const [played, setPlayed] = useState<DiagnosticSection[] | null>(null);
  // Whether this screen reads IntroDB's skip timings, filled in once both
  // answer (up to a few seconds), so the rest of the report never waits on it.
  const [skipCheck, setSkipCheck] = useState({ direct: CHECKING, service: CHECKING });
  const checks = useRef(0);

  const refresh = useCallback(() => {
    const check = ++checks.current;
    void checkSkipTimings().then((result) => {
      if (check !== checks.current) return;
      console.info('[BannerTV diagnostics] skip timings:', JSON.stringify(result));
      setSkipCheck(result);
    });
    void Promise.all([collectDiagnostics(), speedMemory.load(), scorecard.load()]).then(
      ([report]) => {
        const speed = speedSection(speedMemory.results());
        const full = [...report, speed, subtitleSection(), ...scorecardSections(true)];
        console.info('[BannerTV diagnostics]', JSON.stringify(full, null, 2));
        setSections([...report, speed, subtitleSection(PLAYS_ON_SCREEN)]);
        setPlayed(scorecardSections());
      },
    );
  }, []);

  useEffect(refresh, [refresh]);
  const refreshAll = () => {
    setSkipCheck({ direct: CHECKING, service: CHECKING });
    refresh();
  };
  useScreenFocus('diagnostics-refresh');
  const skipSection: DiagnosticSection = {
    title: 'Skip timings',
    rows: [
      ['IntroDB itself', skipCheck.direct],
      ['Via BannerTV', skipCheck.service],
    ],
  };
  const shown = page === 'plays' ? played : sections && [...sections, skipSection];
  const columns = page === 'plays' ? PLAYS_COLUMNS : COLUMNS;

  return (
    <div className={screenStyles.screen}>
      <h1 className={screenStyles.title}>{t('settings.diagnostics')}</h1>
      <div className={styles.actions}>
        <Button
          focusKey="diagnostics-page"
          label={t(page === 'plays' ? 'diagnostics.device' : 'diagnostics.plays')}
          onPress={() => setPage(page === 'plays' ? 'device' : 'plays')}
        />
        <Button
          focusKey="diagnostics-refresh"
          label={t('diagnostics.refresh')}
          onPress={refreshAll}
        />
      </div>
      {shown === null ? (
        <p className={screenStyles.lead}>{t('diagnostics.loading')}</p>
      ) : (
        <div className={styles.columns}>
          {columns.map((indexes, position) => (
            <div
              key={indexes.join()}
              className={page === 'plays' && position > 0 ? styles.wide : styles.column}
            >
              {indexes.map((index) => {
                const section = shown[index];
                if (!section) return null;
                return (
                  <section key={section.title} className={styles.section}>
                    <h2 className={styles.heading}>{section.title}</h2>
                    {section.rows.map(([label, value], row) => (
                      <div
                        key={`${row}-${label}`}
                        className={
                          section.stacked
                            ? styles.stacked
                            : page === 'plays'
                              ? styles.play
                              : styles.row
                        }
                      >
                        <span className={styles.label}>{label}</span>
                        <span className={styles.value}>{value}</span>
                      </div>
                    ))}
                  </section>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
