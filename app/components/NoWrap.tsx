import type { ReactNode } from "react";

interface NoWrapProps {
  children: ReactNode;
  /** Line digits up in columns (tabular figures), for amounts, dates and references. */
  numeric?: boolean;
}

/**
 * Keeps a value on one line whatever the column width, so a table's rows
 * line up the same way whether an amount is $2.00 or $2,000.00. Table cells
 * are light DOM, so a plain styled span is enough.
 */
export function NoWrap({ children, numeric = false }: NoWrapProps) {
  return (
    <span
      style={{
        whiteSpace: "nowrap",
        ...(numeric ? { fontVariantNumeric: "tabular-nums" } : {}),
      }}
    >
      {children}
    </span>
  );
}
