import type { FrameSummary } from './stats';
import type { Mode } from './view';

export interface TrialResult {
  mode: Mode;
  at: string;
  userAgent: string;
  devicePixelRatio: number;
  /** Whether the art came from Cinemeta or was made up on the device. */
  data: string;
  /** From start to Home's first frame, data included. */
  mountMs: number;
  firstWalkDown: FrameSummary;
  browse: FrameSummary;
  heapMb: number | null;
  report: Record<string, number | string | null>;
}

const KEY = 'bannertv.motionTrial.results';
/** The last few runs are enough to compare; older ones drop off. */
const KEEP = 24;

export function readResults(): TrialResult[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(value) ? (value as TrialResult[]) : [];
  } catch {
    return [];
  }
}

export function addResult(result: TrialResult): void {
  const results = readResults();
  results.push(result);
  try {
    localStorage.setItem(KEY, JSON.stringify(results.slice(-KEEP)));
  } catch {
    // Storage full or blocked: the console line still has it.
  }
}

export function clearResults(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing kept to clear.
  }
}
