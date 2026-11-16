import { type FetchJson, HttpError, type SubdlHttp } from '@bannertv/core';

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

/**
 * A GET with request headers that resolves on any status, for services that
 * say why they refused in the body (SubDL). The body is read as JSON, and
 * undefined when it is not. Rejects only HttpError('timeout' | 'network'),
 * whose messages never hold the URL: it can carry the viewer's key. Not
 * watched as an addon's answers are: SubDL is no addon.
 */
export const requestJson: SubdlHttp = (url, { headers, timeoutMs }) => {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return fetch(url, { headers, signal: controller.signal, credentials: 'omit' })
    .then(
      async (response) => {
        const body: unknown = await response.json().catch(() => undefined);
        return { status: response.status, body };
      },
      () => {
        throw timedOut
          ? new HttpError('timeout', `No answer after ${Math.round(timeoutMs / 1000)} s`)
          : new HttpError('network', 'SubDL could not be reached');
      },
    )
    .finally(() => clearTimeout(timer));
};
