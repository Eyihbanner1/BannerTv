/**
 * Remembers the last focused child of a container (for example a row's tile)
 * across remounts, so coming back to Home lands where the user left.
 * Norigin keeps the same memory only while the container stays mounted.
 */
const memory = new Map<string, string>();

export function rememberFocus(containerKey: string, childKey: string): void {
  memory.set(containerKey, childKey);
}

export function recallFocus(containerKey: string): string | undefined {
  return memory.get(containerKey);
}

const scrollMemory = new Map<string, number>();

/** Remembers how far a row or list has scrolled, as the index of its first item in view. */
export function rememberScroll(containerKey: string, index: number): void {
  scrollMemory.set(containerKey, index);
}

export function recallScroll(containerKey: string): number {
  return scrollMemory.get(containerKey) ?? 0;
}

/** Forgets every container whose key starts with `prefix`, for example when Home's rows change. */
export function forgetFocus(prefix: string): void {
  for (const map of [memory, scrollMemory] as Array<Map<string, unknown>>) {
    for (const key of Array.from(map.keys())) if (key.indexOf(prefix) === 0) map.delete(key);
  }
}

let pressedKey: string | undefined;

/**
 * Runs a press handler while remembering which focusable was pressed. A
 * pointer click can land on something that never had focus, and Norigin
 * moves focus asynchronously, so the current focus key is not yet the
 * pressed one. Screens opened by the press return to this key on Back.
 */
export function whilePressing(focusKey: string, handler: () => void): void {
  pressedKey = focusKey;
  try {
    handler();
  } finally {
    pressedKey = undefined;
  }
}

/** The focusable being pressed right now, if a press handler is running. */
export function currentlyPressed(): string | undefined {
  return pressedKey;
}
