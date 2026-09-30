import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CartInput } from "../generated/api";
import { cartLinesDiscountsGenerateRun } from "./cart_lines_discounts_generate_run";

/**
 * The fixtures in tests/fixtures run twice: here, through the TypeScript
 * source (fast, no toolchain, part of CI), and in tests/default.test.js,
 * through the compiled Wasm with Shopify's function runner
 * (`npm test -w distributor-pricing`, needs the Shopify CLI).
 */
const fixturesDir = path.join(import.meta.dirname, "..", "tests", "fixtures");

interface Fixture {
  payload: { input: CartInput; output: unknown };
}

describe("fixtures", () => {
  for (const file of fs
    .readdirSync(fixturesDir)
    .filter((name) => name.endsWith(".json"))) {
    it(file, () => {
      const { payload } = JSON.parse(
        fs.readFileSync(path.join(fixturesDir, file), "utf8"),
      ) as Fixture;
      expect(cartLinesDiscountsGenerateRun(payload.input)).toEqual(
        payload.output,
      );
    });
  }
});
