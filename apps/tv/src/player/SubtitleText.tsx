import { createCueIndex, type Cue } from '@bannertv/core';
import type { SubtitleStyle } from '@tv/data/preferences';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { font } from '@brand/tokens/design';
import { px } from '../ui/theme';

const SIZES: Record<SubtitleStyle['size'], number> = { small: 40, medium: 48, large: 58, huge: 70 };
const COLOURS: Record<SubtitleStyle['colour'], string> = {
  white: '#FFFFFF',
  yellow: '#FFE45C',
  cyan: '#7FE7FF',
  green: '#8CF28C',
};

/** Subtitle files from addons, drawn over the picture in the viewer's style (Android draws a stream's own). */
export function SubtitleText({
  cues,
  offset,
  clock,
  look,
  raised,
}: {
  cues: readonly Cue[] | null;
  offset: number;
  clock: () => number;
  look: SubtitleStyle;
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

  const size = px(SIZES[look.size]);
  const line: TextStyle = {
    fontFamily: font.family,
    fontWeight: '600',
    fontSize: size,
    lineHeight: Math.round(size * 1.3),
    color: COLOURS[look.colour],
    textAlign: 'center',
    ...(look.background === 'outline' || look.background === 'shadow'
      ? {
          textShadowColor: 'rgba(0,0,0,0.95)',
          textShadowOffset: { width: 0, height: look.background === 'shadow' ? px(3) : 0 },
          textShadowRadius: px(look.background === 'shadow' ? 8 : 4),
        }
      : {}),
  };
  const box: ViewStyle | null =
    look.background === 'box' || look.background === 'solid'
      ? {
          backgroundColor: look.background === 'solid' ? '#000000' : 'rgba(0,0,0,0.6)',
          paddingHorizontal: px(16),
          paddingVertical: px(4),
          borderRadius: px(6),
        }
      : null;
  const bottom = visible.filter((cue) => !cue.top);
  const top = visible.filter((cue) => cue.top);
  const lowPlace =
    look.position === 'top'
      ? styles.top
      : look.position === 'raised' || raised
        ? styles.raised
        : styles.bottom;
  const render = (cue: Cue, at: number) => (
    <View key={`${cue.start}-${at}`} style={[styles.cue, box]}>
      {cue.lines.map((spans, lineIndex) => (
        <Text key={lineIndex} style={line}>
          {spans.map((span, spanIndex) => (
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
  return (
    <>
      {top.length > 0 ? (
        <View style={[styles.area, styles.top]} pointerEvents="none">
          {top.map(render)}
        </View>
      ) : null}
      {bottom.length > 0 ? (
        <View style={[styles.area, lowPlace]} pointerEvents="none">
          {bottom.map(render)}
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  area: { position: 'absolute', left: '10%', right: '10%', alignItems: 'center', gap: px(4) },
  bottom: { bottom: '7%' },
  raised: { bottom: '30%' },
  top: { top: '7%' },
  cue: { alignItems: 'center' },
  italic: { fontStyle: 'italic' },
  bold: { fontWeight: '800' },
  underline: { textDecorationLine: 'underline' },
});
