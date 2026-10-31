import type { SpeedKind, SpeedVerdict } from '@bannertv/core';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { Pressable } from '../../components/Pressable';
import { speedMemory } from '../../data/playback';
import { runSpeedTest, type SpeedTest, type SpeedTestStep } from '../../lab/speed';
import { readDeviceInfo } from '../../platform/webos';
import { Pane } from './SheetTabs';
import styles from './SleepTimer.module.css';

type Translate = ReturnType<typeof useTranslation>['t'];

/** "Normal", "1.25×". */
export function speedName(t: Translate, rate: number): string {
  return rate === 1 ? t('player.speed.normal') : t('player.speed.rate', { rate });
}

/** "The TV's player, HLS", "hls.js". */
export function speedKindName(t: Translate, kind: SpeedKind): string {
  return t(`player.speed.kind.${kind === 'hls.js' ? 'hlsjs' : kind}`);
}

/**
 * The Info sheet's Speed tab: Normal and the speeds the Lab passed for this
 * kind of stream on this TV, or why there are none. In the Lab it also runs
 * the speed test on what plays.
 */
export function SpeedChoices({
  focusKey,
  rates,
  current,
  kind,
  lab,
  video,
  onChoose,
}: {
  focusKey: string;
  /** The speeds passed for this kind of stream, Normal left out. */
  rates: readonly number[];
  current: number;
  kind: SpeedKind | undefined;
  lab: boolean;
  video: HTMLVideoElement | null;
  onChoose: (rate: number) => void;
}) {
  const { t } = useTranslation();
  // The test sets the speeds itself: a choice pressed meanwhile would read as the TV putting one back.
  const [testing, setTesting] = useState(false);
  const choices = [1, ...rates];
  // A speed the TV put back, or one set by the test, is not a choice: Normal is the nearest.
  const chosen = choices.indexOf(current) >= 0 ? current : 1;
  const note =
    rates.length > 0
      ? t('player.speed.note')
      : kind
        ? t('player.speed.notPassed', { kind: speedKindName(t, kind) })
        : t('player.speed.notTested');
  return (
    <Pane
      focusKey={focusKey}
      // Start and Stop have keys of their own, so a held OK presses only the
      // first. As one gives way to the other, focus comes back here and goes on to it.
      preferred={lab ? `${focusKey}-${testing ? 'stop' : 'test'}` : `${focusKey}-${chosen}`}
      className={styles.content}
    >
      {lab && (
        <SpeedTestPanel focusKey={focusKey} kind={kind} video={video} onRunning={setTesting} />
      )}
      <div className={styles.steps}>
        {choices.map((rate) => {
          const name = speedName(t, rate);
          const on = rate === chosen;
          return (
            <Pressable
              key={rate}
              focusKey={`${focusKey}-${rate}`}
              label={on ? `${name}. ${t('player.sleep.chosen')}` : name}
              className={`${styles.step}${on ? ` ${styles.chosen}` : ''}${testing ? ` ${styles.held}` : ''}`}
              focusedClassName={styles.stepFocused}
              onPress={() => {
                if (!testing) onChoose(rate);
              }}
            >
              {name}
            </Pressable>
          );
        })}
      </div>
      {!lab && (
        <p className={styles.note} role="status">
          {note}
        </p>
      )}
    </Pane>
  );
}

type TestState =
  | { phase: 'idle' }
  | { phase: 'running'; step: SpeedTestStep }
  | { phase: 'done'; verdicts: readonly SpeedVerdict[]; saved: boolean };

/**
 * Settings > Lab only: measures each test speed on the video playing now,
 * asks whether there is sound at those that kept time, and keeps what passed
 * for this kind of stream. Leaving the tab stops it.
 */
function SpeedTestPanel({
  focusKey,
  kind,
  video,
  onRunning,
}: {
  focusKey: string;
  kind: SpeedKind | undefined;
  video: HTMLVideoElement | null;
  onRunning: (running: boolean) => void;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<TestState>({ phase: 'idle' });
  const test = useRef<SpeedTest | null>(null);
  const answer = useRef<((heard: boolean) => void) | null>(null);
  useEffect(() => () => test.current?.stop(), []);

  // The question takes focus wherever it is: the test waits on the answer.
  const listening = state.phase === 'running' && state.step.phase === 'listening';
  useEffect(() => {
    if (listening) void setFocus(`${focusKey}-yes`);
  }, [listening, focusKey]);

  function start() {
    if (!video || !kind) return;
    const running = runSpeedTest(video, {
      onStep: (step) => setState({ phase: 'running', step }),
      heard: () =>
        new Promise<boolean>((resolve) => {
          answer.current = resolve;
        }),
    });
    test.current = running;
    onRunning(true);
    void running.done.then((verdicts) => {
      if (test.current !== running) return;
      test.current = null;
      onRunning(false);
      const firmware = readDeviceInfo()?.platformVersion;
      const saved = speedMemory.record(kind, verdicts, firmware as string | undefined);
      setState({ phase: 'done', verdicts, saved });
    });
  }
  function stop() {
    const running = test.current;
    test.current = null;
    running?.stop();
    onRunning(false);
    setState({ phase: 'idle' });
  }
  function reply(heard: boolean) {
    const resolve = answer.current;
    answer.current = null;
    resolve?.(heard);
  }

  const status =
    state.phase === 'running'
      ? stepText(t, state.step)
      : state.phase === 'done'
        ? resultText(t, state.verdicts, state.saved, kind)
        : kind
          ? t('player.speed.test.ready', { kind: speedKindName(t, kind) })
          : t('player.speed.notTested');
  return (
    <div className={styles.test}>
      <div className={styles.testRow}>
        {state.phase === 'running' ? (
          <Button
            focusKey={`${focusKey}-stop`}
            label={t('player.speed.test.stop')}
            onPress={stop}
          />
        ) : (
          kind &&
          video && (
            <Button
              focusKey={`${focusKey}-test`}
              variant="primary"
              label={t(
                state.phase === 'done' ? 'player.speed.test.again' : 'player.speed.test.start',
              )}
              onPress={start}
            />
          )
        )}
        {listening && (
          <>
            <Button
              focusKey={`${focusKey}-yes`}
              variant="primary"
              label={t('player.speed.test.yes')}
              onPress={() => reply(true)}
            />
            <Button
              focusKey={`${focusKey}-no`}
              label={t('player.speed.test.no')}
              onPress={() => reply(false)}
            />
          </>
        )}
      </div>
      <p className={styles.testStatus} role="status">
        {status}
      </p>
    </div>
  );
}

function stepText(t: Translate, step: SpeedTestStep): string {
  switch (step.phase) {
    case 'baseline':
      return t('player.speed.test.baseline');
    case 'measuring':
      return t('player.speed.test.measuring', { rate: speedName(t, step.rate) });
    case 'listening':
      return t('player.speed.test.listening', { rate: speedName(t, step.rate) });
    case 'normal':
      return t('player.speed.test.normal');
  }
}

/** "Saved for hls.js. 0.75×: passed · 1.25×: no sound · …". */
function resultText(
  t: Translate,
  verdicts: readonly SpeedVerdict[],
  saved: boolean,
  kind: SpeedKind | undefined,
): string {
  if (verdicts.length === 0) return t('player.speed.test.unsteady');
  const lines = verdicts.map((verdict) =>
    t('player.speed.test.verdict', {
      rate: verdict.rate === 1 ? t('player.speed.test.normalAgain') : speedName(t, verdict.rate),
      result: verdict.ok
        ? t('player.speed.test.passed')
        : t(`player.speed.test.why.${verdict.why}`),
    }),
  );
  const head =
    saved && kind
      ? t('player.speed.test.saved', { kind: speedKindName(t, kind) })
      : t('player.speed.test.notSaved');
  return `${head} ${lines.join(' · ')}`;
}
