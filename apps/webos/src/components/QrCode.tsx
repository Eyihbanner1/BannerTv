import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

interface QrCodeProps {
  text: string;
  size: number;
  className?: string;
}

/** Margin around the code, in modules: the four the QR standard asks for. */
const QUIET_ZONE = 4;

/**
 * A QR code as one SVG path: dark modules on white, which phone cameras read
 * best, with each run of dark modules in a row drawn as a single rectangle.
 */
export function QrCode({ text, size, className }: QrCodeProps) {
  const { view, path } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    let d = '';
    for (let row = 0; row < count; row++) {
      let col = 0;
      while (col < count) {
        if (!qr.isDark(row, col)) {
          col++;
          continue;
        }
        const start = col;
        while (col < count && qr.isDark(row, col)) col++;
        d += `M${start + QUIET_ZONE} ${row + QUIET_ZONE}h${col - start}v1h-${col - start}z`;
      }
    }
    return { view: count + QUIET_ZONE * 2, path: d };
  }, [text]);

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${view} ${view}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <rect width={view} height={view} fill="#fff" />
      <path d={path} fill="#0B0815" />
    </svg>
  );
}
