import { describe, expect, it, vi } from "vitest";
import { commissionWhere } from "./dashboard.server";

vi.mock("../db.server", () => ({ default: {} }));
vi.mock("../shopify.server", () => ({ unauthenticated: { admin: vi.fn() } }));

describe("commissionWhere", () => {
  it("always scopes to the shop", () => {
    expect(commissionWhere("luma.myshopify.com", {})).toEqual({
      shop: "luma.myshopify.com",
    });
  });

  it("narrows by engine state", () => {
    expect(
      commissionWhere("luma.myshopify.com", { syncStatus: "failed" }),
    ).toEqual({ shop: "luma.myshopify.com", syncStatus: "failed" });
  });

  it("searches name, code and order number, ignoring case and padding", () => {
    const where = commissionWhere("luma.myshopify.com", { query: "  Ana " });
    expect(where.OR).toEqual([
      { distributorName: { contains: "Ana", mode: "insensitive" } },
      { referralCode: { contains: "Ana", mode: "insensitive" } },
      { orderName: { contains: "Ana", mode: "insensitive" } },
    ]);
  });

  it("treats a blank search as no search", () => {
    expect(commissionWhere("luma.myshopify.com", { query: "   " })).toEqual({
      shop: "luma.myshopify.com",
    });
  });
});
