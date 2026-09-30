import type { EventRow } from "../services/dashboard.server";
import { formatDate } from "./CommissionsTable";
import { NoWrap } from "./NoWrap";

/**
 * Webhook deliveries as a table: what arrived, what happened to it, and a
 * way to run a failed job again. Shared by the dashboard and the full page.
 */

type EventStatus = "received" | "processing" | "processed" | "failed";

const eventTone: Record<
  EventStatus,
  "info" | "success" | "critical" | "warning"
> = {
  received: "info",
  processing: "warning",
  processed: "success",
  failed: "critical",
};

interface DeliveriesTableProps {
  rows: EventRow[];
  busy: boolean;
  onReprocess: (webhookId: string) => void;
}

export function DeliveriesTable({
  rows,
  busy,
  onReprocess,
}: DeliveriesTableProps) {
  return (
    <s-table>
      <s-table-header-row>
        <s-table-header listSlot="primary">Received</s-table-header>
        <s-table-header>Topic</s-table-header>
        <s-table-header>Status</s-table-header>
        <s-table-header>Details</s-table-header>
        <s-table-header></s-table-header>
      </s-table-header-row>
      <s-table-body>
        {rows.map((event) => (
          <s-table-row key={event.id}>
            <s-table-cell>
              <NoWrap numeric>{formatDate(event.receivedAt)}</NoWrap>
            </s-table-cell>
            <s-table-cell>
              <NoWrap>{event.topic}</NoWrap>
            </s-table-cell>
            <s-table-cell>
              <s-badge tone={eventTone[event.status as EventStatus] ?? "info"}>
                {event.status}
              </s-badge>
            </s-table-cell>
            <s-table-cell>
              {event.error ??
                (event.attempts > 1 ? `${event.attempts} attempts` : "")}
            </s-table-cell>
            <s-table-cell>
              <s-button
                variant="tertiary"
                onClick={() => onReprocess(event.id)}
                {...(busy ? { disabled: true } : {})}
              >
                Reprocess
              </s-button>
            </s-table-cell>
          </s-table-row>
        ))}
      </s-table-body>
    </s-table>
  );
}
