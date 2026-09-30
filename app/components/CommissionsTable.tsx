import type { CommissionRow } from "../services/dashboard.server";
import { NoWrap } from "./NoWrap";

/**
 * The commissions ledger as a table: one row per paid order, with the
 * engine hand-off state and its Retry/Sync action. Shared by the dashboard
 * (latest rows) and the full, paginated page.
 */

export const statusLabel: Record<string, string> = {
  written_back: "on order",
  calculated: "calculated",
  unattributed: "no referral",
  unknown_distributor: "unknown code",
  inactive_distributor: "inactive",
};

export function commissionTone(
  status: string,
): "success" | "warning" | "info" | "critical" {
  switch (status) {
    case "written_back":
      return "success";
    case "calculated":
      return "info";
    case "unknown_distributor":
    case "inactive_distributor":
      return "critical";
    default:
      return "warning";
  }
}

export const syncTone: Record<
  string,
  "success" | "warning" | "critical" | "neutral"
> = {
  synced: "success",
  pending: "warning",
  failed: "critical",
  skipped: "neutral",
};

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** `gid://shopify/Order/123` → `123`, the admin URL id. */
export function legacyId(gid: string): string {
  return gid.split("/").pop() ?? gid;
}

interface CommissionsTableProps {
  rows: CommissionRow[];
  busy: boolean;
  onSync: (commissionId: string) => void;
}

export function CommissionsTable({
  rows,
  busy,
  onSync,
}: CommissionsTableProps) {
  return (
    <s-table>
      <s-table-header-row>
        <s-table-header listSlot="primary">Order</s-table-header>
        <s-table-header>Distributor</s-table-header>
        <s-table-header format="currency">Commission</s-table-header>
        <s-table-header>Status</s-table-header>
        <s-table-header>Engine</s-table-header>
      </s-table-header-row>
      <s-table-body>
        {rows.map((commission) => (
          <s-table-row key={commission.id}>
            <s-table-cell>
              <s-stack direction="block" gap="small-200">
                <s-link
                  href={`shopify://admin/orders/${legacyId(commission.orderId)}`}
                  target="_blank"
                >
                  {commission.orderName}
                </s-link>
                <s-text color="subdued">
                  <NoWrap numeric>{formatDate(commission.paidAt)}</NoWrap>
                </s-text>
              </s-stack>
            </s-table-cell>
            <s-table-cell>
              {commission.distributorName ?? commission.referralCode ?? "—"}
            </s-table-cell>
            <s-table-cell>
              <s-stack direction="block" gap="small-200" alignItems="end">
                <s-text>
                  <NoWrap numeric>{commission.amount}</NoWrap>
                </s-text>
                <s-text color="subdued">
                  <NoWrap numeric>
                    {commission.rate} of {commission.base}
                  </NoWrap>
                </s-text>
              </s-stack>
            </s-table-cell>
            <s-table-cell>
              <s-badge tone={commissionTone(commission.status)}>
                {statusLabel[commission.status] ?? commission.status}
              </s-badge>
            </s-table-cell>
            <s-table-cell>
              {commission.payable ? (
                <EngineCell
                  commission={commission}
                  busy={busy}
                  onSync={() => onSync(commission.id)}
                />
              ) : (
                <s-text color="subdued">—</s-text>
              )}
            </s-table-cell>
          </s-table-row>
        ))}
      </s-table-body>
    </s-table>
  );
}

interface EngineCellProps {
  commission: Pick<
    CommissionRow,
    "syncStatus" | "syncReference" | "syncError" | "syncAttempts"
  >;
  busy: boolean;
  onSync: () => void;
}

/** The hand-off to the engine: its state, the reference it gave, or why it failed. */
export function EngineCell({ commission, busy, onSync }: EngineCellProps) {
  const failed = commission.syncStatus === "failed";
  const attempts = commission.syncAttempts;
  return (
    <s-stack direction="block" gap="small-200">
      <s-stack direction="inline" gap="small" alignItems="center">
        <s-badge tone={syncTone[commission.syncStatus] ?? "neutral"}>
          {commission.syncStatus}
        </s-badge>
        {failed || commission.syncStatus === "pending" ? (
          <s-button
            variant="tertiary"
            onClick={onSync}
            {...(busy ? { disabled: true } : {})}
          >
            {failed ? "Retry" : "Sync"}
          </s-button>
        ) : null}
      </s-stack>
      {commission.syncReference ? (
        <s-text color="subdued">
          <NoWrap numeric>{commission.syncReference}</NoWrap>
        </s-text>
      ) : null}
      {failed && commission.syncError ? (
        <s-text color="subdued">
          {commission.syncError} · after {attempts}{" "}
          {attempts === 1 ? "attempt" : "attempts"}
        </s-text>
      ) : null}
    </s-stack>
  );
}
