import { createCueIndex, type Cue } from '@bannertv/core';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { font } from '../ui/theme';

/** Subtitle files from addons, drawn over the picture (subtitles inside the file Android draws). */
export function SubtitleText({
  cues,
  offset,
  clock,
  raised,
}: {
  cues: readonly Cue[] | null;
  offset: number;
  clock: () => number;
  raised: boolean;
}) {
  const index = useMemo(() => (cues ? createCueIndex(cues) : null), [cues]);
  const [showing, setShowing] = useState<Cue[]>([]);
  useEffect(() => {
    if (!index) return;
    const tick = () => {
      const next = index.at(clock() - offset);
      setShowing((before) =>
        before.length === next.length && before.every((cue, at) => cue === next[at])
          ? before
          : next,
      );
    };
    const timer = setInterval(tick, 100);
    return () => clearInterval(timer);
  }, [index, offset, clock]);
  const visible = index ? showing : [];
  if (visible.length === 0) return null;
  const bottom = visible.filter((cue) => !cue.top);
  const top = visible.filter((cue) => cue.top);
  return (
    <>
      {top.length > 0 ? (
        <View style={[styles.area, styles.top]} pointerEvents="none">
          {top.map(renderCue)}
        </View>
      ) : null}
      {bottom.length > 0 ? (
        <View style={[styles.area, raised ? styles.raised : styles.bottom]} pointerEvents="none">
          {bottom.map(renderCue)}
        </View>
      ) : null}
    </>
  );
}

function renderCue(cue: Cue, index: number) {
  return (
    <View key={`${cue.start}-${index}`} style={styles.cue}>
      {cue.lines.map((line, lineIndex) => (
        <Text key={lineIndex} style={styles.line}>
          {line.map((span, spanIndex) => (
            <Text
              key={spanIndex}
              style={[
                span.italic && styles.italic,
                span.bold && styles.bold,
                span.underline && styles.underline,
              ]}
            >
              {span.text}
            </Text>
          ))}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  area: { position: 'absolute', left: '8%', right: '8%', alignItems: 'center', gap: 2 },
  bottom: { bottom: '6%' },
  raised: { bottom: '26%' },
  top: { top: '6%' },
  cue: { alignItems: 'center' },
  line: {
    fontFamily: font,
    fontWeight: '600',
    fontSize: 20,
    lineHeight: 26,
    color: '#FFFFFF',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.95)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 4,
  },
  italic: { fontStyle: 'italic' },
  bold: { fontWeight: '800' },
  underline: { textDecorationLine: 'underline' },
});
