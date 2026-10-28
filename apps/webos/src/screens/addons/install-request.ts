// Set by the first-run screen's "Add an addon": the Addons screen then opens
// with Add an addon already showing. Read while that screen renders, and
// cleared once it has mounted, so StrictMode's second render reads it too.
let requested = false;

export function requestInstallDialog(): void {
  requested = true;
}

export function installRequested(): boolean {
  return requested;
}

export function clearInstallRequest(): void {
  requested = false;
}
