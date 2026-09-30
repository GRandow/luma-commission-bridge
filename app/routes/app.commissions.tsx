import { useEffect, useRef, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  useFetcher,
  useLoaderData,
  useNavigate,
  useNavigation,
  useRouteError,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { CommissionsTable } from "../components/CommissionsTable";
import { Pagination } from "../components/Pagination";
import { RouteErrorBoundary } from "../components/RouteErrorBoundary";
import {
  PAGE_SIZE,
  parsePage,
  parseQuery,
  parseSyncFilter,
  SYNC_FILTERS,
  type SyncFilter,
} from "../domain/paging";
import { pageCommissions } from "../services/dashboard.server";
import { authenticate } from "../shopify.server";
import type { action as dashboardAction } from "./app._index";

/**
 * The whole commissions ledger, a page at a time, narrowed by engine state
 * and by a free-text search on the distributor, the code or the order.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const filter = parseSyncFilter(url.searchParams.get("sync"));
  const query = parseQuery(url.searchParams.get("q"));
  const page = await pageCommissions(
    session.shop,
    parsePage(url.searchParams.get("page")),
    { syncStatus: filter, query },
  );
  return { page, filter, query };
};

function hrefFor(
  page: number,
  filter: SyncFilter | null,
  query: string,
): string {
  const params = new URLSearchParams();
  if (page > 1) params.set("page", String(page));
  if (filter) params.set("sync", filter);
  if (query) params.set("q", query);
  const search = params.toString();
  return `/app/commissions${search ? `?${search}` : ""}`;
}

const filterLabel: Record<SyncFilter, string> = {
  synced: "Synced",
  pending: "Pending",
  failed: "Failed",
  skipped: "Skipped",
};

/** How long after the last keystroke the search is applied. */
const SEARCH_DEBOUNCE_MS = 300;

export default function CommissionsPage() {
  const { page, filter, query } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof dashboardAction>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.message) {
      shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
    }
  }, [fetcher.data, shopify]);

  // What is typed in the search box, ahead of what the page has loaded.
  const [search, setSearch] = useState(query);
  // The last search this page asked the loader for, so a change that came
  // from elsewhere (Clear, the Back button, a shared link) refreshes the box
  // without a slow reply clobbering what is being typed.
  const requested = useRef(query);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (navigation.state === "idle" && query !== requested.current) {
      requested.current = query;
      setSearch(query);
    }
  }, [query, navigation.state]);

  const show = (
    toFilter: SyncFilter | null,
    toQuery: string,
    replace = false,
  ) => {
    clearTimeout(pending.current);
    requested.current = toQuery;
    navigate(hrefFor(1, toFilter, toQuery), { replace });
  };

  // Filter as you type, a moment after the last keystroke, replacing the
  // history entry so Back does not walk through every keystroke.
  const onSearchInput = (event: Event) => {
    const field = event.currentTarget as HTMLElementTagNameMap["s-text-field"];
    const typed = field.value ?? "";
    setSearch(typed);
    clearTimeout(pending.current);
    pending.current = setTimeout(() => {
      const wanted = parseQuery(typed);
      if (wanted !== requested.current) show(filter, wanted, true);
    }, SEARCH_DEBOUNCE_MS);
  };

  useEffect(() => () => clearTimeout(pending.current), []);

  // Retry/Sync live on the dashboard's action; after it runs, React Router
  // reloads this page's loader, so the row updates in place.
  const retrySync = (commissionId: string) =>
    fetcher.submit(
      { intent: "retry-sync", commissionId },
      { method: "POST", action: "/app?index" },
    );

  const noun = page.total === 1 ? "commission" : "commissions";

  return (
    <s-page heading="Commissions">
      <s-section>
        <s-stack direction="block" gap="base">
          <s-stack
            direction="inline"
            gap="base"
            alignItems="center"
            justifyContent="space-between"
          >
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-button
                variant={filter === null ? "primary" : "secondary"}
                onClick={() => show(null, parseQuery(search))}
              >
                All
              </s-button>
              {SYNC_FILTERS.map((value) => (
                <s-button
                  key={value}
                  variant={filter === value ? "primary" : "secondary"}
                  onClick={() => show(value, parseQuery(search))}
                >
                  {filterLabel[value]}
                </s-button>
              ))}
            </s-stack>
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-box inlineSize="280px">
                <s-text-field
                  label="Search"
                  labelAccessibilityVisibility="exclusive"
                  icon="search"
                  placeholder="Distributor, code or order"
                  value={search}
                  onInput={onSearchInput}
                />
              </s-box>
              {search ? (
                <s-button variant="tertiary" onClick={() => show(filter, "")}>
                  Clear
                </s-button>
              ) : null}
            </s-stack>
          </s-stack>
          {page.rows.length === 0 ? (
            <s-paragraph>
              {query
                ? `Nothing matches “${query}”${filter ? ` among ${filter} commissions` : ""}.`
                : filter
                  ? `No commissions with engine state "${filter}".`
                  : "No paid orders yet."}
            </s-paragraph>
          ) : (
            <CommissionsTable rows={page.rows} busy={busy} onSync={retrySync} />
          )}
          <Pagination
            page={page.page}
            pageCount={page.pageCount}
            total={page.total}
            noun={query ? `${noun} matching “${query}”` : noun}
            hrefFor={(target) => hrefFor(target, filter, query)}
          />
        </s-stack>
      </s-section>
      <s-section heading="About this list">
        <s-paragraph>
          One row per paid order, newest first, {PAGE_SIZE} to a page, kept
          until the app is uninstalled. The search matches the
          distributor&apos;s name, the referral code and the order number.
        </s-paragraph>
        <s-paragraph>
          The Engine column is the hand-off to the commission engine:{" "}
          <em>failed</em> rows can be retried once the cause is fixed;{" "}
          <em>pending</em> rows can be synced by hand.
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
