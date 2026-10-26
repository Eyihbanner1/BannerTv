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
