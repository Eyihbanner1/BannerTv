/**
 * Seconds from the parts of a subtitle timestamp, or undefined when the parts
 * cannot be a time (minutes or seconds past 59). The fraction is read as
 * decimal digits, so "5" is half a second and "500" is too: SRT writers that
 * drop trailing zeros mean the same thing as those that keep them.
 */
export function toSeconds(
  hours: string | undefined,
  minutes: string,
  seconds: string,
  fraction: string | undefined,
): number | undefined {
  const m = Number(minutes);
  const s = Number(seconds);
  if (m >= 60 || s >= 60) return undefined;
  const whole = Number(hours ?? '0') * 3600 + m * 60 + s;
  if (!fraction) return whole;
  // Whole units of the fraction, divided once, give the closest double to the
  // written time: 1.234 rather than 1.2340000000000002. Past nanoseconds the
  // digits cannot matter, and a few hundred of them would make the scale
  // Infinity and the time NaN.
  const digits = fraction.slice(0, 9);
  const scale = Math.pow(10, digits.length);
  return (whole * scale + Number(digits)) / scale;
}
