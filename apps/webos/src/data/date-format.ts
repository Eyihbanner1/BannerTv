/**
 * Writes a date exactly as `date.toLocaleDateString(locale, options)` (or
 * toLocaleTimeString) would, from one formatter made on first use. Given
 * options, those methods build a new ICU formatter on every call, which
 * engines cannot cache: a fraction of a millisecond each on the TV, and the
 * episode list dates every drawn episode on each move.
 *
 * The formatter keeps the time zone it was made in, where those methods follow
 * the device's. So it is made again when the device's zone changes (a phone
 * that travelled), told by its UTC offsets this January and July: a zone with
 * the same offset now but other summer time, London after UTC, still differs.
 */
export function dateFormatter(
  locale: string,
  options: Intl.DateTimeFormatOptions,
): (date: Date) => string {
  let formatter: Intl.DateTimeFormat | undefined;
  let madeInJanuary = 0;
  let madeInJuly = 0;
  return (date) => {
    // What toLocaleDateString says for one; format() would throw.
    if (isNaN(date.getTime())) return 'Invalid Date';
    const year = new Date().getFullYear();
    const january = new Date(year, 0, 1).getTimezoneOffset();
    const july = new Date(year, 6, 1).getTimezoneOffset();
    if (formatter === undefined || january !== madeInJanuary || july !== madeInJuly) {
      formatter = new Intl.DateTimeFormat(locale, options);
      madeInJanuary = january;
      madeInJuly = july;
    }
    return formatter.format(date);
  };
}
