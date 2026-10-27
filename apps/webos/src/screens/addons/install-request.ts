// Set by the first-run screen's "Add an addon": the Addons screen then opens
// with Add an addon already showing. Read once, when that screen mounts.
let requested = false;

export function requestInstallDialog(): void {
  requested = true;
}

export function takeInstallRequest(): boolean {
  const value = requested;
  requested = false;
  return value;
}
