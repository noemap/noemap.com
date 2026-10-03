export function Pagination({
  pathname,
  offset,
  hasMore,
  query = {},
  fragment = "",
}: {
  pathname: string;
  offset: number;
  hasMore: boolean;
  query?: Record<string, string | undefined>;
  fragment?: string;
}) {
  if (!offset && !hasMore) return null;
  function href(next: number) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query))
      if (value) params.set(key, value);
    if (next > 0) params.set("offset", String(next));
    const search = params.toString();
    return `${pathname}${search ? `?${search}` : ""}${fragment}`;
  }
  return (
    <nav className="exploration-pagination" aria-label="一覧のページ切り替え">
      {offset > 0 ? (
        <a href={href(Math.max(0, offset - 20))}>← 前の20件</a>
      ) : (
        <span />
      )}
      {hasMore ? <a href={href(offset + 20)}>次の20件 →</a> : null}
    </nav>
  );
}
