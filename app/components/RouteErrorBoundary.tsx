import { useEffect, useState } from "react";
import { isRouteErrorResponse } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { isTransientRouteError } from "../utils/route-errors";

const RELOAD_AFTER_MS = 2500;

/**
 * What the app shows when a route throws.
 *
 * - A request that failed in transit (tunnel, proxy, DNS, a dev server
 *   reloading) is not an app error: say so and load the page again.
 * - A refusal with an empty body (401, 403…) would otherwise render as the
 *   bare words "Handling response"; show the status and what it usually
 *   means instead, so a screenshot is enough to diagnose it.
 * - Everything else goes to Shopify's boundary, which keeps the response
 *   headers App Bridge needs for its redirects.
 *
 * Used by the layout route and the dashboard, because React Router
 * attributes a failed data request to the outermost route it was loading.
 */
export function RouteErrorBoundary({ error }: { error: unknown }) {
  const transient = isTransientRouteError(error);
  const [environment, setEnvironment] = useState<string | null>(null);

  useEffect(() => {
    if (!transient) return;
    const timer = setTimeout(() => window.location.reload(), RELOAD_AFTER_MS);
    return () => clearTimeout(timer);
  }, [transient]);

  useEffect(() => {
    const appBridge = "shopify" in window ? "loaded" : "not loaded";
    const embedded = window.top === window.self ? "top-level" : "embedded";
    setEnvironment(
      `App Bridge ${appBridge} · ${embedded} · ${location.pathname}`,
    );
  }, []);

  if (transient) {
    return (
      <s-page heading="Commission bridge">
        <s-section>
          <s-banner tone="warning" heading="Reconnecting to the app server">
            The last request did not get through. This page reloads itself in a
            moment; nothing was lost.
          </s-banner>
        </s-section>
      </s-page>
    );
  }

  if (isRouteErrorResponse(error) && !error.data) {
    const heading = `The app server answered ${error.status}${
      error.statusText ? ` ${error.statusText}` : ""
    }`;
    return (
      <s-page heading="Commission bridge">
        <s-section>
          <s-banner tone="critical" heading={heading}>
            <s-paragraph>{explain(error.status)}</s-paragraph>
            {environment ? (
              <s-paragraph>
                <s-text color="subdued">{environment}</s-text>
              </s-paragraph>
            ) : null}
            <s-button
              slot="secondary-actions"
              onClick={() => window.location.reload()}
            >
              Reload
            </s-button>
          </s-banner>
        </s-section>
      </s-page>
    );
  }

  return boundary.error(error);
}

function explain(status: number): string {
  switch (status) {
    case 401:
      return "The request carried no valid session token. Inside the Shopify admin, App Bridge attaches one to every request; a 401 here means the page was loaded without it or the token could not be verified (check the dev server log for the reason).";
    case 403:
      return "The store refused the request. The app may need to be reinstalled on this store.";
    case 404:
      return "That route does not exist on the app server.";
    default:
      return "The server refused the request without further detail. The dev server log has the reason.";
  }
}
