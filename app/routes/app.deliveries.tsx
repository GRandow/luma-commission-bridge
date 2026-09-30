import { useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { DeliveriesTable } from "../components/DeliveriesTable";
import { Pagination } from "../components/Pagination";
import { RouteErrorBoundary } from "../components/RouteErrorBoundary";
import { parsePage } from "../domain/paging";
import { pageWebhookEvents } from "../services/dashboard.server";
import { authenticate } from "../shopify.server";
import type { action as dashboardAction } from "./app._index";

/** Every webhook delivery still on record, a page at a time. */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const page = await pageWebhookEvents(
    session.shop,
    parsePage(url.searchParams.get("page")),
  );
  return { page };
};

const hrefFor = (page: number) =>
  page > 1 ? `/app/deliveries?page=${page}` : "/app/deliveries";

export default function DeliveriesPage() {
  const { page } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof dashboardAction>();
  const shopify = useAppBridge();
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.message) {
      shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
    }
  }, [fetcher.data, shopify]);

  const reprocess = (webhookId: string) =>
    fetcher.submit(
      { intent: "reprocess", webhookId },
      { method: "POST", action: "/app?index" },
    );

  return (
    <s-page heading="Webhook deliveries">
      <s-section>
        <s-stack direction="block" gap="base">
          {page.rows.length === 0 ? (
            <s-paragraph>Nothing received yet.</s-paragraph>
          ) : (
            <DeliveriesTable
              rows={page.rows}
              busy={busy}
              onReprocess={reprocess}
            />
          )}
          <Pagination
            page={page.page}
            pageCount={page.pageCount}
            total={page.total}
            noun={page.total === 1 ? "delivery" : "deliveries"}
            hrefFor={hrefFor}
          />
        </s-stack>
      </s-section>
      <s-section heading="About this list">
        <s-paragraph>
          Every <code>orders/paid</code> delivery is recorded under
          Shopify&apos;s webhook id before it is processed, so a retried
          delivery is recognised and skipped. Payloads are purged after 30 days;
          a failed job can be queued again from here while its payload is still
          on record.
        </s-paragraph>
        <s-paragraph>
          <s-link href="/app">Back to the overview</s-link>
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return <RouteErrorBoundary error={useRouteError()} />;
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
