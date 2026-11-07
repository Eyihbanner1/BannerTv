/**
 * Whether a side panel builds its body. Android's Modal draws nothing while it is closed, so a
 * closed panel's rows (one per subtitle file, say) are not built at all on each render of the
 * player. iOS and the web fade a closing Modal's content out, so there the body is kept from
 * opening until the Modal says it has gone.
 */
export function drawsPanelBody(visible: boolean, kept: boolean, os: string): boolean {
  return visible || (kept && os !== 'android');
}
