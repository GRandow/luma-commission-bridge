/**
 * The part of Shopify's `orders/paid` webhook payload this app reads.
 * Payloads follow the REST order shape (snake_case, money as strings).
 * Customer fields are only present when the app has protected customer data
 * access, which the commission flow does not need.
 */
export interface OrdersPaidPayload {
  id: number;
  admin_graphql_api_id: string;
  /** Order number as shown in the admin, e.g. "#1001". */
  name: string;
  currency: string;
  /** Line items after discounts, before shipping and tax. */
  subtotal_price: string;
  /** Same as `subtotal_price` but reflecting later edits and refunds. */
  current_subtotal_price?: string;
  total_price: string;
  financial_status: string;
  processed_at: string | null;
  created_at: string;
  test?: boolean;
  note_attributes: Array<{ name: string; value: string | null }>;
  line_items: Array<{
    id: number;
    title: string;
    quantity: number;
    price: string;
  }>;
}
