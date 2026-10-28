import { type FetchJson, HttpError } from '@bannertv/core';

/**
 * The core's FetchJson over window.fetch. Packaged apps run from file://, so
 * every addon request is cross-origin; addons answer with
 * Access-Control-Allow-Origin: * as the protocol requires. Errors never
 * include the URL, which can carry the user's API keys.
 */
export const fetchJson: FetchJson = (url, { timeoutMs }) => {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return fetch(url, { signal: controller.signal, credentials: 'omit' })
    .then(
      (response) => {
        if (!response.ok) {
          throw new HttpError('status', `The addon answered ${response.status}`, response.status);
        }
        return response.json().catch(() => {
          throw new HttpError('invalid', 'The addon did not answer with JSON');
        });
      },
      () => {
        throw timedOut
          ? new HttpError('timeout', `No answer after ${Math.round(timeoutMs / 1000)} s`)
          : new HttpError('network', 'The addon could not be reached');
      },
    )
    .finally(() => clearTimeout(timer)) as Promise<unknown>;
};
