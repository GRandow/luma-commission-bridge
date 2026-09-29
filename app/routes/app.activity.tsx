import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { loadDashboardActivity } from "../services/dashboard.server";

/**
 * JSON the dashboard polls every few seconds. App Bridge attaches the
 * session token to same-origin fetches, so this is authenticated like any
 * other admin request; a failed poll is simply skipped by the page.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return Response.json(await loadDashboardActivity(session.shop), {
    headers: { "Cache-Control": "no-store" },
  });
};
