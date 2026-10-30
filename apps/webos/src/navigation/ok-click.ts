import { KeyCode } from './keys';

/** A click this soon after OK is the same press. */
const CLICK_AFTER_OK_MS = 400;
let lastOkAt = -Infinity;

/**
 * In pointer mode the Magic Remote OK can come as a key press and then a
 * click where the pointer is. Whatever took the key press, the click is the
 * same press: it must not press something else, such as a control the key
 * press has just brought up under the pointer. Seen on every OK, before
 * anything answers it.
 */
export function noteOk(event: KeyboardEvent): void {
  if (event.keyCode === KeyCode.Ok) lastOkAt = Date.now();
}

/** Whether a click now came with the latest OK, which has been answered already. */
export function clickCameWithOk(): boolean {
  return Date.now() - lastOkAt <= CLICK_AFTER_OK_MS;
}
