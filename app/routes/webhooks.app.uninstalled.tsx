import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { deleteShopData } from "../services/retention.server";

/**
 * When a merchant uninstalls the app, everything it holds about their store
 * goes with it: sessions, recorded webhook deliveries and the commission
 * ledger. Shopify may deliver this webhook more than once; deleting is
 * idempotent, so a repeat is harmless.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`[webhooks] ${topic} for ${shop}: deleting the shop's data.`);

  await deleteShopData(shop);

  return new Response();
};
