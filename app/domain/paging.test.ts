import { describe, expect, it } from "vitest";
import {
  pageMeta,
  parsePage,
  parseQuery,
  parseSyncFilter,
  QUERY_MAX_LENGTH,
} from "./paging";

describe("paging helpers", () => {
  it("reads ?page= defensively", () => {
    expect(parsePage("3")).toBe(3);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-2")).toBe(1);
    expect(parsePage("abc")).toBe(1);
    expect(parsePage(null)).toBe(1);
  });

  it("clamps the page to what exists and computes the offset", () => {
    expect(pageMeta(0, 1, 25)).toEqual({ page: 1, pageCount: 1, skip: 0 });
    expect(pageMeta(26, 2, 25)).toEqual({ page: 2, pageCount: 2, skip: 25 });
    expect(pageMeta(26, 9, 25)).toEqual({ page: 2, pageCount: 2, skip: 25 });
    expect(pageMeta(50, 2, 25)).toEqual({ page: 2, pageCount: 2, skip: 25 });
  });

  it("accepts only known sync statuses as filters", () => {
    expect(parseSyncFilter("failed")).toBe("failed");
    expect(parseSyncFilter("synced")).toBe("synced");
    expect(parseSyncFilter("everything")).toBeNull();
    expect(parseSyncFilter(null)).toBeNull();
  });

  it("trims and caps the free-text search", () => {
    expect(parseQuery("  ana ")).toBe("ana");
    expect(parseQuery(null)).toBe("");
    expect(parseQuery("   ")).toBe("");
    expect(parseQuery("x".repeat(QUERY_MAX_LENGTH + 20))).toHaveLength(
      QUERY_MAX_LENGTH,
    );
  });
});
