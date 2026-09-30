import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Unit tests only. The Function's fixture tests (extensions/distributor-pricing/tests)
    // compile it to Wasm with the Shopify CLI: run them with
    // `npm test -w distributor-pricing`.
    include: ["app/**/*.test.ts", "extensions/*/src/**/*.test.{ts,js}"],
  },
});
