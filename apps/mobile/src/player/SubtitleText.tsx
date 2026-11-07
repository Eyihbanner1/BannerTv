import { createCueIndex, type Cue } from '@bannertv/core';
import type { SubtitleStyle } from '@tv/data/preferences';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { font } from '../ui/theme';
import { type SubtitleLook, subtitleLook } from './subtitle-look';

/** The ends of a line inside its box, as the TV pads them: React Native's inline text takes no padding. */
const PAD = ' ';

/**
 * Subtitles drawn over the picture in the profile's subtitle style: addon files, and the file's
 * own subtitles, which Android hands over line by line (modules/banner-cues). Picture subtitles
 * (PGS, DVB) Android still draws itself.
 */
export function SubtitleText({
  cues,
  offset,
  clock,
  raised,
  look,
}: {
  cues: readonly Cue[] | null;
  offset: number;
  clock: () => number;
  /** The controls show: lines move clear of them. */
  raised: boolean;
  look: SubtitleStyle;
}) {
  const { width, height } = useWindowDimensions();
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
  const drawn = subtitleLook(look, { width, height }, raised);
  // With the style at the top, the lines the file places there join the rest.
  const top = drawn.allAtTop ? visible : visible.filter((cue) => cue.top);
  const bottom = drawn.allAtTop ? [] : visible.filter((cue) => !cue.top);
  return (
    <>
      {top.length > 0 ? (
        <View style={[styles.area, drawn.allAtTop ? drawn.main : drawn.upper]} pointerEvents="none">
          {top.map((cue, at) => renderCue(cue, at, drawn))}
        </View>
      ) : null}
      {bottom.length > 0 ? (
        <View style={[styles.area, drawn.main]} pointerEvents="none">
          {bottom.map((cue, at) => renderCue(cue, at, drawn))}
        </View>
      ) : null}
    </>
  );
}

function renderCue(cue: Cue, index: number, drawn: SubtitleLook) {
  return (
    <View key={`${cue.start}-${index}`} style={[styles.cue, { marginTop: drawn.cueGap }]}>
      {cue.lines.map((line, lineIndex) => (
        <Text key={lineIndex} style={[styles.line, drawn.text]}>
          {drawn.back ? (
            // A box behind each wrapped line, as on the TV.
            <Text style={{ backgroundColor: drawn.back }}>
              {PAD}
              {renderSpans(line)}
              {PAD}
            </Text>
          ) : (
            renderSpans(line)
          )}
        </Text>
      ))}
    </View>
  );
}

function renderSpans(line: Cue['lines'][number]) {
  return line.map((span, spanIndex) => (
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
  ));
}

const styles = StyleSheet.create({
  area: { position: 'absolute', left: '8%', right: '8%', alignItems: 'center' },
  cue: { alignItems: 'center' },
  line: { fontFamily: font, fontWeight: '600', textAlign: 'center' },
  italic: { fontStyle: 'italic' },
  bold: { fontWeight: '800' },
  underline: { textDecorationLine: 'underline' },
});
