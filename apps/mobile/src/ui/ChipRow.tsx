import { LinearGradient } from 'expo-linear-gradient';
import { Children, isValidElement, type ReactNode, useEffect, useRef, useState } from 'react';
import {
  type AccessibilityRole,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  type ScrollViewInstance,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { clearOf, moreAt, offsetToShow, type Spot } from './chip-row';
import { colors, gutter, space } from './theme';

/** How wide the fade is at an end with more pills past it. */
const FADE = 28;

/**
 * A line of pills that scrolls sideways when it does not fit: Search's kinds, Browse's genres, a
 * series' seasons, Sports' days. It never gives up height to a list below it: React Native lets
 * a horizontal ScrollView shrink by default, which cut Search's pills in half once results came
 * in. A fade at an end shows while more pills are past it, and the chosen pill is scrolled into
 * view once the row has laid out and again whenever the choice changes, so a remembered genre
 * or season far along the row is never off screen.
 */
export function ChipRow({
  children,
  selected,
  inset = gutter,
  bleed = false,
  gap = space.s,
  fadeColor = colors.bg,
  style,
  accessibilityLabel,
  accessibilityRole,
  keyboardShouldPersistTaps,
}: {
  children: ReactNode;
  /** Which pill is chosen, counted from 0 among those shown, to keep in view. */
  selected?: number;
  /** Space before the first pill and after the last: the screen's side margin. */
  inset?: number;
  /**
   * The row sits inside something padded by `inset` (a title's body): it reaches out to the
   * screen's edges, so pills are not cut off short of them, and still starts in line.
   */
  bleed?: boolean;
  gap?: number;
  /** What the row sits on, which the fades blend into. */
  fadeColor?: string;
  /** Margins around the row. */
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  keyboardShouldPersistTaps?: 'always' | 'never' | 'handled';
}) {
  const scroller = useRef<ScrollViewInstance>(null);
  const width = useRef(0);
  const contentWidth = useRef(0);
  const offset = useRef(0);
  const spots = useRef<Array<Spot | undefined>>([]);
  // The choice last scrolled into view: none until the row has laid out.
  const revealed = useRef<number | undefined>(undefined);
  const [more, setMore] = useState({ before: false, after: false });
  const chosen = selected !== undefined && selected >= 0 ? selected : undefined;

  const scrolled = () => ({
    offset: offset.current,
    width: width.current,
    contentWidth: contentWidth.current,
  });
  const showFades = () => {
    const { before, after } = moreAt(scrolled());
    setMore((was) => (was.before === before && was.after === after ? was : { before, after }));
  };

  // Scrolls just far enough that the chosen pill sits clear of the fades. It waits until the
  // row, its contents and that pill have all been measured.
  const reveal = (index: number | undefined) => {
    if (index === undefined || index === revealed.current) return;
    const spot = spots.current[index];
    if (!spot || width.current === 0 || contentWidth.current === 0) return;
    // The first time the row simply opens there; a new choice slides into view.
    const animated = revealed.current !== undefined;
    revealed.current = index;
    const target = offsetToShow(spot, scrolled(), Math.max(inset, FADE));
    if (target !== undefined) scroller.current?.scrollTo({ x: target, animated });
  };

  useEffect(() => reveal(chosen));

  const onLayout = (event: LayoutChangeEvent) => {
    width.current = event.nativeEvent.layout.width;
    showFades();
    reveal(chosen);
  };
  const onContentSizeChange = (contentW: number) => {
    contentWidth.current = contentW;
    showFades();
    reveal(chosen);
  };
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = event.nativeEvent.contentOffset.x;
    showFades();
  };
  const place = (index: number, event: LayoutChangeEvent) => {
    const { x, width: pillWidth } = event.nativeEvent.layout;
    spots.current[index] = { x, width: pillWidth };
    if (index === chosen) reveal(chosen);
  };

  const faded = clearOf(fadeColor);
  return (
    <View style={[styles.row, bleed && { marginHorizontal: -inset }, style]}>
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.row}
        contentContainerStyle={{ paddingHorizontal: inset, gap }}
        onLayout={onLayout}
        onContentSizeChange={onContentSizeChange}
        onScroll={onScroll}
        onMomentumScrollEnd={onScroll}
        scrollEventThrottle={16}
        {...(accessibilityLabel !== undefined ? { accessibilityLabel } : {})}
        {...(accessibilityRole !== undefined ? { accessibilityRole } : {})}
        {...(keyboardShouldPersistTaps !== undefined ? { keyboardShouldPersistTaps } : {})}
      >
        {Children.toArray(children).map((child, index) => (
          <View
            key={isValidElement(child) && child.key !== null ? child.key : index}
            onLayout={(event) => place(index, event)}
          >
            {child}
          </View>
        ))}
      </ScrollView>
      {/* The fades only shade the pills: a touch goes through to the pill underneath. */}
      {more.before ? (
        <View style={[styles.fade, styles.start]}>
          <LinearGradient
            colors={[fadeColor, faded]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </View>
      ) : null}
      {more.after ? (
        <View style={[styles.fade, styles.end]}>
          <LinearGradient
            colors={[faded, fadeColor]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Neither the row nor its ScrollView grows or shrinks with the list beside it.
  row: { flexGrow: 0, flexShrink: 0 },
  fade: { position: 'absolute', top: 0, bottom: 0, width: FADE, pointerEvents: 'none' },
  start: { left: 0 },
  end: { right: 0 },
});
