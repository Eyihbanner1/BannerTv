/**
 * A check that is true when it is given the same values as the time before,
 * one by one as React compares a hook's dependencies, so work that reads
 * nothing else can be skipped. The first call is never the same.
 */
export function sameAsLast(): (values: readonly unknown[]) => boolean {
  let last: readonly unknown[] | undefined;
  return (values) => {
    const before = last;
    last = values;
    return (
      before !== undefined &&
      before.length === values.length &&
      values.every((value, i) => Object.is(value, before[i]))
    );
  };
}
