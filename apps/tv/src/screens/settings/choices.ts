/** The choice after `current` in `options`, back to the first after the last. OK walks a setting's choices this way. */
export function nextChoice<T>(options: readonly T[], current: T): T {
  const index = options.indexOf(current);
  return options[(index + 1) % options.length]!;
}
