# distributor-code — checkout UI extension

Lets the shopper enter a distributor code inside Shopify's checkout, or see (and remove) the one the storefront already put on the cart.

It writes the `ref` cart attribute — the same key the headless storefront uses — so Shopify copies it onto the order as a note attribute and the app's `orders/paid` pipeline attributes the commission without knowing where the code came from.

- Target: `purchase.checkout.block.render` (placed by the merchant in the checkout editor; rendered automatically in the `shopify app dev` preview).
- Built with Preact and Polaris web components (`s-text-field`, `s-banner`, …) on `@shopify/ui-extensions` 2026-07.
- Before a code is applied, the extension asks the app whether it belongs to an active distributor (`src/lookup.js`): the request goes to the URL the app publishes in the `$app:checkout_api` shop metafield, carrying the session token Shopify issues to the extension, and the app answers `valid` and the distributor's name. An unknown code is refused with a message; a code that arrived from the storefront's link is looked up too, so the banner can name the distributor or flag a bad code.
- The lookup is a courtesy, not a gate: if the app cannot be reached, the code is applied anyway and attribution is decided when the order is paid.
- Format rules (`src/referral-code.js`) and the lookup are unit-tested from the app root (`npm test`).
- Renders nothing when the checkout does not accept attribute changes (accelerated checkouts), instead of showing a field that cannot work.

Run `shopify app dev` from the app root, open the app's dashboard once (it writes the metafield), then open the extension's preview from the Dev Console; deploy with `shopify app deploy`.
