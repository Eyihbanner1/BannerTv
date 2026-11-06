import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { Overlay } from '../../components/Overlay';
import type { ProblemText } from '../../player/describe';
import styles from './PlayerScreen.module.css';

interface PlayerProblemProps {
  /** What went wrong and what was tried, from problemText. */
  text: ProblemText;
  /** Addons that did not answer, so the viewer knows the list may be short. */
  failedAddons: number;
  canTryAnother: boolean;
  onTryAnother: () => void;
  onAllStreams: () => void;
  onRetry: () => void;
  onBack: () => void;
}

/**
 * What went wrong in plain words, and the ways on from it. Back leaves the
 * player; a stray click beside the box does not.
 */
export function PlayerProblem(props: PlayerProblemProps) {
  const { text, failedAddons, canTryAnother } = props;
  const { t } = useTranslation();
  const title = text.title;
  const first = canTryAnother ? 'player-problem-another' : 'player-problem-streams';
  return (
    <Overlay
      focusKey="player-problem"
      label={title}
      defaultFocusKey={first}
      returnFocusKey="player-surface"
      onClose={props.onBack}
      placement="center"
      closeOnOutsideClick={false}
    >
      <h2 className={styles.problemTitle}>{title}</h2>
      {text.lines.map((line) => (
        <p key={line} className={styles.problemMessage}>
          {line}
        </p>
      ))}
      {failedAddons > 0 && (
        <p className={styles.problemMessage}>
          {t('player.problem.addonsFailed', { count: failedAddons })}
        </p>
      )}
      <div className={styles.problemActions}>
        {canTryAnother && (
          <Button
            focusKey="player-problem-another"
            variant="primary"
            label={t('player.problem.tryAnother')}
            onPress={props.onTryAnother}
          />
        )}
        <Button
          focusKey="player-problem-streams"
          variant={canTryAnother ? 'secondary' : 'primary'}
          label={t('player.allStreams')}
          onPress={props.onAllStreams}
        />
        <Button
          focusKey="player-problem-retry"
          label={t('common.tryAgain')}
          onPress={props.onRetry}
        />
        <Button
          focusKey="player-problem-back"
          label={t('player.problem.back')}
          onPress={props.onBack}
        />
      </div>
    </Overlay>
  );
}
