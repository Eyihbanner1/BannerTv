/** A click this soon after OK is the same press. */
const CLICK_AFTER_OK_MS = 400;
let answeredAt = -Infinity;

/**
 * In pointer mode the Magic Remote OK can come as a key press and then a
 * click where the pointer is. Whatever answered the key press calls this, so
 * the click does not press a second thing: one the key press has just
 * brought up under the pointer, say. A key press nothing answered, such as
 * one a text box took, leaves the click to press what the pointer is on.
 */
export function answeredOk(): void {
  answeredAt = Date.now();
}

/** Whether a click now came with an OK that something has answered already. */
export function clickCameWithOk(): boolean {
  return Date.now() - answeredAt <= CLICK_AFTER_OK_MS;
}
