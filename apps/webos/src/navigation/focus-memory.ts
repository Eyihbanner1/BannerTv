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
