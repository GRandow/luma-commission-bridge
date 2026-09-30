# distributor-pricing

A Shopify Function on the Discount API (`cart.lines.discounts.generate.run`) that prices the cart for a direct-sales store:

- a shopper referred by an active distributor (the `ref` cart attribute) gets the **referral discount**, at that distributor's own rate or the default;
- a signed-in customer linked to an active distributor (the `$app:distributor` customer metafield) buys at **wholesale**, by the distributor's level. Signed in means `buyerIdentity.isAuthenticated`: Shopify attaches the customer as soon as a known email is typed, which proves nothing;
- when both apply the larger wins; they never stack, and a distributor cannot use their own code for the referral discount.

The Function cannot call the app, so the app writes everything it needs into a JSON metafield on the automatic discount it creates (`$app:pricing_config`): the merchant's percentages and the active distributors. See `app/domain/pricing.ts` for the producer side of that contract and `src/pricing.ts` for the reader.

```
src/cart_lines_discounts_generate_run.graphql   the input query: ref attribute, sign-in state, customer's distributor, lines, config
src/pricing.ts                                   the decision (pure, no generated types)
src/cart_lines_discounts_generate_run.ts         decision → one product discount on every line
generated/api.ts                                 types from the input query (`shopify app function typegen`), committed for CI
tests/fixtures/*.json                            input → expected output, checked against the schema
```

```bash
npm test                          # from the app root: unit tests + fixtures through the TypeScript source
npm test -w distributor-pricing   # fixtures through the compiled Wasm and Shopify's function runner (needs the Shopify CLI)
```
