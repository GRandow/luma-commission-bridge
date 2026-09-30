import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import {
  useAppMetafields,
  useApplyAttributeChange,
  useAttributeValues,
  useInstructions,
  useSessionToken,
} from "@shopify/ui-extensions/checkout/preact";
import { normalizeReferralCode, REFERRAL_ATTRIBUTE_KEY } from "./referral-code";
import {
  CONFIG_KEY,
  CONFIG_NAMESPACE,
  lookupReferralCode,
  lookupWithRetry,
  readCheckoutConfig,
} from "./lookup";

/**
 * "Distributor code" inside Shopify's checkout.
 *
 * A shopper who arrived through a distributor's link already has the code
 * on the cart (the storefront put it there); this shows who gets credit and
 * lets them remove it. A shopper who only has the code can type it here.
 * Either way the result is the same `ref` cart attribute, which Shopify
 * copies onto the order and the app turns into a commission.
 *
 * Codes are checked with the app before they are applied, so a typo is
 * caught while the buyer can still fix it. If the app cannot be reached the
 * code is applied anyway: attribution is decided when the order is paid.
 */
export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const instructions = useInstructions();
  const applyAttributeChange = useApplyAttributeChange();
  const [currentCode] = useAttributeValues([REFERRAL_ATTRIBUTE_KEY]);
  const sessionToken = useSessionToken();
  const config = readCheckoutConfig(
    useAppMetafields({
      type: "shop",
      namespace: CONFIG_NAMESPACE,
      key: CONFIG_KEY,
    }),
  );
  const [input, setInput] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  /** What the app said about each code seen so far. */
  const [known, setKnown] = useState({});

  const lookupInput = (code) => ({
    validateUrl: config?.validateUrl,
    code,
    getToken: () => sessionToken.get(),
  });

  // The code on the cart (from the storefront's link, or applied here) is
  // looked up so the banner can name the distributor or flag a bad code. If
  // the app does not answer it is asked again a couple of times; only then
  // does the banner settle for the code alone.
  useEffect(() => {
    if (!currentCode || known[currentCode]) return;
    let cancelled = false;
    lookupWithRetry(lookupInput(currentCode), {
      isCancelled: () => cancelled,
    }).then((result) => {
      if (!cancelled) setKnown((all) => ({ ...all, [currentCode]: result }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCode, config?.validateUrl]);

  // Accelerated checkouts (Shop Pay, Apple Pay…) may not accept attribute
  // changes; showing a field that cannot work would only confuse the buyer.
  if (!instructions.attributes.canUpdateAttributes) return null;

  const t = (key, replacements) => shopify.i18n.translate(key, replacements);

  async function apply() {
    const code = normalizeReferralCode(input);
    if (!code) {
      setError(t("invalid"));
      return;
    }
    setBusy(true);
    const verdict = await lookupReferralCode(lookupInput(code));
    if (verdict.status === "invalid") {
      setBusy(false);
      setError(t("notRecognized"));
      return;
    }
    const result = await applyAttributeChange({
      type: "updateAttribute",
      key: REFERRAL_ATTRIBUTE_KEY,
      value: code,
    });
    setBusy(false);
    if (result.type === "error") {
      // The message is for developers, not buyers; keep it in the console.
      console.error(
        "[distributor-code] could not set the attribute",
        result.message,
      );
      setError(t("couldNotApply"));
      return;
    }
    // A code applied while the app was unreachable is left to the lookup
    // above, which retries and fills in the name once the app answers.
    if (verdict.status !== "unavailable") {
      setKnown((all) => ({ ...all, [code]: verdict }));
    }
    setInput("");
    setError(null);
  }

  async function remove() {
    setBusy(true);
    await applyAttributeChange({
      type: "removeAttribute",
      key: REFERRAL_ATTRIBUTE_KEY,
    });
    setBusy(false);
  }

  if (currentCode) {
    const verdict = known[currentCode];
    const unknown = verdict?.status === "invalid";
    const heading = unknown
      ? t("unknownCodeHeading", { code: currentCode })
      : verdict?.status === "valid" && verdict.name
        ? t("referredByName", { name: verdict.name, code: currentCode })
        : t("referredBy", { code: currentCode });
    return (
      <s-banner heading={heading} tone={unknown ? "warning" : "success"}>
        <s-stack gap="base">
          <s-text>{unknown ? t("unknownCodeHelp") : t("creditNotice")}</s-text>
          <s-button variant="secondary" onClick={remove} disabled={busy}>
            {t("remove")}
          </s-button>
        </s-stack>
      </s-banner>
    );
  }

  return (
    <s-form onSubmit={apply}>
      <s-stack gap="base">
        <s-heading>{t("heading")}</s-heading>
        <s-text>{t("help")}</s-text>
        <s-stack direction="inline" gap="base" alignItems="end">
          <s-text-field
            label={t("label")}
            value={input}
            error={error ?? undefined}
            maxLength={32}
            autocomplete="off"
            onInput={(event) => {
              // The event is typed generically; the target is the text field.
              const field =
                /** @type {HTMLElementTagNameMap["s-text-field"]} */ (
                  /** @type {unknown} */ (event.currentTarget)
                );
              setInput(field.value ?? "");
              if (error) setError(null);
            }}
          />
          <s-button type="submit" variant="secondary" loading={busy}>
            {t("apply")}
          </s-button>
        </s-stack>
      </s-stack>
    </s-form>
  );
}
