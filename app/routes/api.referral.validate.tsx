import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  shopFromDest,
  validateReferralCode,
} from "../services/referral-validation.server";

/**
 * `GET /api/referral/validate?code=ANA123`, called by the checkout UI
 * extension. The extension sends the session token Shopify issues to it;
 * `authenticate.public.checkout` verifies that JWT (signature, expiry) and
 * tells us which shop the checkout belongs to, so a request cannot look up
 * distributors of another store. Responses carry CORS headers because the
 * extension runs on Shopify's extensions origin, not the app's — including
 * error responses, or the browser reports CORS instead of the real error.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { cors, sessionToken } = await authenticate.public.checkout(request);
  const shop = shopFromDest(sessionToken.dest);
  const code = new URL(request.url).searchParams.get("code");

  try {
    const result = await validateReferralCode(shop, code);
    return cors(
      Response.json(result, { headers: { "Cache-Control": "no-store" } }),
    );
  } catch (error) {
    console.error("[referral-validate] lookup failed", error);
    return cors(
      Response.json(
        { code: null, valid: false, name: null, error: "lookup_failed" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      ),
    );
  }
};
