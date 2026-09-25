import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { enqueueOrderProcessing } from "../services/commissions.server";
import { recordWebhookEvent } from "../services/webhook-events.server";
import type { OrdersPaidPayload } from "../types/orders-paid";

/**
 * `orders/paid` webhook.
 *
 * `authenticate.webhook` checks the HMAC signature against the app secret and
 * rejects anything that did not come from Shopify. The handler then does the
 * least possible work: record the delivery (which also detects retries),
 * queue the processing and answer 200. Shopify expects a response within
 * seconds and retries otherwise; everything slow happens in the queue.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, webhookId } =
    await authenticate.webhook(request);
  const order = payload as unknown as OrdersPaidPayload;

  const { isNew } = await recordWebhookEvent({
    id: webhookId,
    shop,
    topic,
    payload,
  });
  if (!isNew) {
    console.log(
      `[webhooks] ${topic} ${webhookId} already recorded; ignoring the retry.`,
    );
    return new Response();
  }

  console.log(`[webhooks] ${topic} for ${shop}: order ${order.name} queued.`);
  void enqueueOrderProcessing({ webhookId, shop, order });

  return new Response();
};
