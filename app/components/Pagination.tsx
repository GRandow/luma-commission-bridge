interface PaginationProps {
  page: number;
  pageCount: number;
  total: number;
  noun: string;
  hrefFor: (page: number) => string;
}

/** "Page x of y · n items" on the left, Previous / Next on the right, as plain links so pages are shareable. */
export function Pagination({
  page,
  pageCount,
  total,
  noun,
  hrefFor,
}: PaginationProps) {
  return (
    <s-stack
      direction="inline"
      gap="base"
      alignItems="center"
      justifyContent="space-between"
    >
      <s-text color="subdued">
        Page {page} of {pageCount} · {total} {noun}
      </s-text>
      <s-stack direction="inline" gap="small" alignItems="center">
        <s-button
          variant="secondary"
          href={hrefFor(page - 1)}
          {...(page <= 1 ? { disabled: true } : {})}
        >
          Previous
        </s-button>
        <s-button
          variant="secondary"
          href={hrefFor(page + 1)}
          {...(page >= pageCount ? { disabled: true } : {})}
        >
          Next
        </s-button>
      </s-stack>
    </s-stack>
  );
}
