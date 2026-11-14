import { SPEED_KINDS, type SpeedResults } from '@bannertv/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useScreenFocus } from '../app/use-screen-focus';
import { Button } from '../components/Button';
import { speedMemory } from '../data/playback';
import { checkSkipTimings } from '../data/skips';
import {
  collectDiagnostics,
  type DiagnosticRow,
  type DiagnosticSection,
} from '../platform/diagnostics';
import { formatClock } from '../player/media';
import { subtitleTraceRows } from '../player/subtitle-trace';
import screenStyles from './Screen.module.css';
import styles from './DiagnosticsScreen.module.css';

// Sections per column, so the whole report fits on one 1920x1080 screen.
const COLUMNS = [
  [0, 1],
  [2, 4, 5],
  [3, 6],
];

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

/**
 * The subtitles of the last few plays: whether the video's hash was read,
 * the files in each language, why the version showing was chosen, and how
 * long the first line took. Ids, counts and times only, never a link.
 */
function subtitleSection(): DiagnosticSection {
  return { title: 'Subtitles', rows: subtitleTraceRows(), stacked: true };
}

/**
 * Spike 1 and the device facts the later spikes need. The report also goes
 * to the console, so `pnpm tv:inspect` can copy it.
 */
export function DiagnosticsScreen() {
  const { t } = useTranslation();
  const [sections, setSections] = useState<DiagnosticSection[] | null>(null);
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
    void Promise.all([collectDiagnostics(), speedMemory.load()]).then(([report]) => {
      const full = [...report, speedSection(speedMemory.results()), subtitleSection()];
      console.info('[BannerTV diagnostics]', JSON.stringify(full, null, 2));
      setSections(full);
    });
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
  const shown = sections && [...sections, skipSection];

  return (
    <div className={screenStyles.screen}>
      <h1 className={screenStyles.title}>{t('settings.diagnostics')}</h1>
      <div className={styles.actions}>
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
          {COLUMNS.map((indexes) => (
            <div key={indexes.join()} className={styles.column}>
              {indexes.map((index) => {
                const section = shown[index];
                if (!section) return null;
                return (
                  <section key={section.title} className={styles.section}>
                    <h2 className={styles.heading}>{section.title}</h2>
                    {section.rows.map(([label, value], row) => (
                      <div
                        key={`${row}-${label}`}
                        className={section.stacked ? styles.stacked : styles.row}
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
