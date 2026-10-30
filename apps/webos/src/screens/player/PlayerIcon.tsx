import type { ReactNode } from 'react';

export type PlayerIconName =
  | 'play'
  | 'pause'
  | 'start'
  | 'back10'
  | 'fwd10'
  | 'next'
  | 'subs'
  | 'quality'
  | 'sources'
  | 'episodes'
  | 'info'
  | 'live'
  | 'back';

const LINE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

// The 10 inside the skip arrows, in the app's font.
function ten(): ReactNode {
  return (
    <text x="12" y="15.9" textAnchor="middle" fontSize="7.4" fontWeight="800" fill="currentColor">
      10
    </text>
  );
}

// On the side menu's 24 unit grid (RailIcon), with its 1.8 strokes and round
// ends. Playback glyphs are solid so they read from the sofa. Play is the
// Prism Play mark: the triangle in its three facets, with the gaps drawn in
// rather than cut by a mask, so no two icons share an id.
const GLYPHS: Record<PlayerIconName, ReactNode> = {
  play: (
    <g fill="currentColor" stroke="currentColor" strokeWidth="0.6" strokeLinejoin="round">
      <path d="M6.96 4.24 18.25 11.23 10.85 11.23Z" />
      <path d="M10.85 12.78 18.25 12.78 6.96 19.76Z" />
      <path d="M5.6 4.99 9.51 12 5.6 19.01Z" />
    </g>
  ),
  pause: (
    <>
      <rect x="6" y="4.6" width="4.3" height="14.8" rx="1.3" fill="currentColor" />
      <rect x="13.7" y="4.6" width="4.3" height="14.8" rx="1.3" fill="currentColor" />
    </>
  ),
  start: (
    <>
      <rect x="4.8" y="5.4" width="2.7" height="13.2" rx="1.1" fill="currentColor" />
      <path
        d="M18.6 6.4v11.2a.9.9 0 0 1-1.4.73L9.5 12.73a.9.9 0 0 1 0-1.46l7.7-5.6a.9.9 0 0 1 1.4.73Z"
        fill="currentColor"
      />
    </>
  ),
  back10: (
    <>
      <path d="M12 5.4a7.6 7.6 0 1 1-7.6 7.6" {...LINE} />
      <path d="M14.6 2.9 12 5.4l2.6 2.5" {...LINE} />
      {ten()}
    </>
  ),
  fwd10: (
    <>
      <path d="M12 5.4a7.6 7.6 0 1 0 7.6 7.6" {...LINE} />
      <path d="M9.4 2.9 12 5.4 9.4 7.9" {...LINE} />
      {ten()}
    </>
  ),
  next: (
    <>
      <rect x="16.5" y="5.4" width="2.7" height="13.2" rx="1.1" fill="currentColor" />
      <path
        d="M5.4 6.4v11.2a.9.9 0 0 0 1.4.73l7.7-5.6a.9.9 0 0 0 0-1.46L6.8 5.67a.9.9 0 0 0-1.4.73Z"
        fill="currentColor"
      />
    </>
  ),
  subs: (
    <>
      <path
        d="M5 4.5h14A2.5 2.5 0 0 1 21.5 7v8.5A2.5 2.5 0 0 1 19 18h-7.5L7 21.5V18H5a2.5 2.5 0 0 1-2.5-2.5V7A2.5 2.5 0 0 1 5 4.5Z"
        {...LINE}
      />
      <path d="M6.6 10h4.6M13.8 10h3.6M6.6 13.6h7.4M16.6 13.6h.8" {...LINE} />
    </>
  ),
  quality: (
    <>
      <path d="M3.8 7.5h9.6M17.6 7.5h2.6M3.8 16.5h2.8M10.8 16.5h9.4" {...LINE} />
      <circle cx="15.5" cy="7.5" r="2.1" {...LINE} />
      <circle cx="8.7" cy="16.5" r="2.1" {...LINE} />
    </>
  ),
  sources: (
    <>
      <path d="M12 3.6 20.8 8 12 12.4 3.2 8Z" {...LINE} />
      <path d="M3.2 12.2 12 16.6l8.8-4.4M3.2 16.2 12 20.6l8.8-4.4" {...LINE} />
    </>
  ),
  // Stacked cards.
  episodes: (
    <>
      <rect x="3.4" y="8.4" width="17.2" height="11.6" rx="2.2" {...LINE} />
      <path d="M5.8 5.4h12.4M8.2 2.6h7.6" {...LINE} />
    </>
  ),
  // An i in a circle.
  info: (
    <>
      <circle cx="12" cy="12" r="8.6" {...LINE} />
      <path d="M12 11v5.4" {...LINE} />
      <circle cx="12" cy="7.8" r="0.4" {...LINE} />
    </>
  ),
  // A broadcast: a dot sending out waves either side.
  live: (
    <>
      <circle cx="12" cy="12" r="2.4" fill="currentColor" />
      <path d="M8.3 8.3a5.2 5.2 0 0 0 0 7.4M15.7 8.3a5.2 5.2 0 0 1 0 7.4" {...LINE} />
      <path d="M5.4 5.4a9.3 9.3 0 0 0 0 13.2M18.6 5.4a9.3 9.3 0 0 1 0 13.2" {...LINE} />
    </>
  ),
  back: (
    <>
      <path d="M9.2 14 4.4 9.2l4.8-4.8" {...LINE} />
      <path d="M4.4 9.2h10a5.2 5.2 0 0 1 0 10.4h-3.8" {...LINE} />
    </>
  ),
};

/** A player icon. Its name is on the control it sits in, for Audio Guidance. */
export function PlayerIcon({ name, size }: { name: PlayerIconName; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {GLYPHS[name]}
    </svg>
  );
}
