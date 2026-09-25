import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrdersPaidPayload } from "../types/orders-paid";

const upsert = vi.fn();
const update = vi.fn();
vi.mock("../db.server", () => ({
  default: { commission: { upsert, update } },
}));
vi.mock("../shopify.server", () => ({
  unauthenticated: { admin: vi.fn() },
}));
const enqueueCommissionSync = vi.fn().mockResolvedValue(undefined);
vi.mock("./commission-sync.server", () => ({
  enqueueCommissionSync: (...args: unknown[]) => enqueueCommissionSync(...args),
}));

const { processPaidOrder } = await import("./commissions.server");

const order: OrdersPaidPayload = {
  id: 1005,
  admin_graphql_api_id: "gid://shopify/Order/1005",
  name: "#1005",
  currency: "USD",
  subtotal_price: "42.00",
  current_subtotal_price: "42.00",
  total_price: "47.25",
  financial_status: "paid",
  processed_at: "2026-09-24T21:15:00Z",
  created_at: "2026-09-24T21:14:00Z",
  note_attributes: [{ name: "ref", value: "ana123" }],
  line_items: [
    { id: 1, title: "Cotton Waffle Bath Towel", quantity: 1, price: "42.00" },
  ],
};

const ana = {
  id: "gid://shopify/Metaobject/1",
  handle: "ana123",
  code: "ANA123",
  name: "Ana Souza",
  level: "Consultant",
  rateBps: 1250,
  active: true,
};

const admin = { graphql: vi.fn() };

function deps(overrides: Partial<Parameters<typeof processPaidOrder>[2]> = {}) {
  return {
    getAdmin: vi.fn().mockResolvedValue(admin),
    findDistributorByCode: vi.fn().mockResolvedValue(ana),
    writeCommissionToOrder: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("processPaidOrder", () => {
  beforeEach(() => {
    enqueueCommissionSync.mockClear();
    upsert
      .mockReset()
      .mockImplementation(({ create }) =>
        Promise.resolve({ id: "c1", ...create }),
      );
    update
      .mockReset()
      .mockImplementation(({ data }) => Promise.resolve({ id: "c1", ...data }));
  });

  it("attributes the order, applies the distributor's rate and writes it back", async () => {
    const d = deps();

    const result = await processPaidOrder("luma-dev.myshopify.com", order, d);

    expect(d.findDistributorByCode).toHaveBeenCalledWith(admin, "ANA123");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          shop_orderId: {
            shop: "luma-dev.myshopify.com",
            orderId: "gid://shopify/Order/1005",
          },
        },
        create: expect.objectContaining({
          orderName: "#1005",
          baseCents: 4200,
          rateBps: 1250,
          amountCents: 525,
          referralCode: "ANA123",
          distributorName: "Ana Souza",
          status: "calculated",
        }),
      }),
    );
    expect(d.writeCommissionToOrder).toHaveBeenCalledWith(admin, {
      orderId: "gid://shopify/Order/1005",
      amountCents: 525,
      currency: "USD",
      rateBps: 1250,
      distributorCode: "ANA123",
      distributorName: "Ana Souza",
    });
    expect(result.status).toBe("written_back");
    expect(enqueueCommissionSync).toHaveBeenCalledWith("c1", "#1005");
  });

  it("stores an unattributed commission without touching the order", async () => {
    const d = deps();

    const result = await processPaidOrder(
      "luma-dev.myshopify.com",
      { ...order, note_attributes: [] },
      d,
    );

    expect(d.findDistributorByCode).not.toHaveBeenCalled();
    expect(d.writeCommissionToOrder).not.toHaveBeenCalled();
    expect(enqueueCommissionSync).not.toHaveBeenCalled();
    expect(result.status).toBe("unattributed");
    expect(result.amountCents).toBe(420);
    expect(result.syncStatus).toBe("skipped");
  });

  it("flags an unknown code and does not write it back", async () => {
    const d = deps({ findDistributorByCode: vi.fn().mockResolvedValue(null) });

    const result = await processPaidOrder("luma-dev.myshopify.com", order, d);

    expect(result.status).toBe("unknown_distributor");
    expect(d.writeCommissionToOrder).not.toHaveBeenCalled();
  });

  it("records a failed write-back on the row and rethrows so the queue retries", async () => {
    const d = deps({
      writeCommissionToOrder: vi.fn().mockRejectedValue(new Error("Throttled")),
    });

    await expect(
      processPaidOrder("luma-dev.myshopify.com", order, d),
    ).rejects.toThrow("Throttled");
    expect(update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { writebackError: "Throttled" },
    });
  });
});
