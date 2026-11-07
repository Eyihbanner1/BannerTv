import Svg, { Polygon } from 'react-native-svg';

/** The Prism Play mark, drawn small for the Home bar (the facets of brand/logo). */
export function PrismMark({ size = 28 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 44 44" accessible={false}>
      <Polygon points="10,6 38,22 10,22" fill="#C9B5FF" />
      <Polygon points="10,22 38,22 10,38" fill="#4B23C8" />
      <Polygon points="10,14 24,22 10,30" fill="#7B4DFF" />
    </Svg>
  );
}
