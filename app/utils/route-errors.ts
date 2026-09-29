import { isRouteErrorResponse } from "react-router";

/**
 * Errors that mean "the request did not get through", not "the app is
 * broken": gateway errors from the tunnel or proxy, a dev server in the
 * middle of a reload, a timeout, a name that did not resolve. The page
 * recovers from these by loading again; anything else is shown.
 */
export function isTransientRouteError(error: unknown): boolean {
  if (isRouteErrorResponse(error)) {
    return (
      error.status === 0 ||
      error.status === 408 ||
      error.status === 429 ||
      error.status >= 500
    );
  }
  // What `fetch` throws when the network or DNS fails, per browser engine.
  return (
    error instanceof TypeError &&
    /failed to fetch|networkerror|load failed|network request failed/i.test(
      error.message,
    )
  );
}
