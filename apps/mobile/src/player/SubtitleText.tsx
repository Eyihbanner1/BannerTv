import { createCueIndex, type Cue } from '@bannertv/core';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, type TextStyle, View } from 'react-native';
import { font } from '../ui/theme';
import { subtitleTextStyle, useSubtitleStyle } from './SubtitleStyle';

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
  const look = useSubtitleStyle();
  const lineStyle = useMemo(() => [styles.line, subtitleTextStyle(look)], [look]);
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
  // A cue placed at the top stays there; the viewer's position moves the rest.
  const atTop = look.position === 'top';
  const bottom = atTop ? [] : visible.filter((cue) => !cue.top);
  const top = atTop ? visible : visible.filter((cue) => cue.top);
  const draw = (cue: Cue, at: number) => renderCue(cue, at, lineStyle);
  return (
    <>
      {top.length > 0 ? (
        <View style={[styles.area, styles.top]} pointerEvents="none">
          {top.map(draw)}
        </View>
      ) : null}
      {bottom.length > 0 ? (
        <View
          style={[
            styles.area,
            raised ? styles.raised : look.position === 'raised' ? styles.lifted : styles.bottom,
          ]}
          pointerEvents="none"
        >
          {bottom.map(draw)}
        </View>
      ) : null}
    </>
  );
}

function renderCue(cue: Cue, index: number, lineStyle: TextStyle[]) {
  return (
    <View key={`${cue.start}-${index}`} style={styles.cue}>
      {cue.lines.map((line, lineIndex) => (
        <Text key={lineIndex} style={lineStyle}>
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
  lifted: { bottom: '16%' },
  top: { top: '6%' },
  cue: { alignItems: 'center' },
  // Size, colour and background come from the viewer's subtitle style.
  line: { fontFamily: font, fontWeight: '600', textAlign: 'center' },
  italic: { fontStyle: 'italic' },
  bold: { fontWeight: '800' },
  underline: { textDecorationLine: 'underline' },
});
