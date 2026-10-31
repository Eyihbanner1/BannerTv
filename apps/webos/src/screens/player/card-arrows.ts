/**
 * A corner card's arrows (Up Next, the sleep timer's warning): Left and Right
 * move between its buttons, and Up or Down brings the controls up in its
 * place, as they do over the picture. False takes the press from spatial
 * navigation, whose focus boundary would otherwise swallow it.
 */
export function cardArrows(onControls: () => void): (direction: string) => boolean {
  return (direction) => {
    if (direction !== 'up' && direction !== 'down') return true;
    onControls();
    return false;
  };
}
