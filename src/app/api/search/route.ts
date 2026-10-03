import { searchEntryNodes, entryCatalog } from "../../../server/entry";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const type = query.get("type") || undefined;
  const theme = query.get("theme") || undefined,
    discipline = query.get("discipline") || undefined;
  const offset = Number(query.get("offset") ?? "0");
  const headers = { "Cache-Control": "private, no-store" };
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 10000 ||
    (type && !["question", "person", "concept", "work"].includes(type)) ||
    (query.get("q")?.length ?? 0) > 160 ||
    (theme && !entryCatalog.themes.some((t) => t.id === theme)) ||
    (discipline && !entryCatalog.disciplines.some((d) => d.id === discipline))
  )
    return Response.json(
      { error: "検索条件を確認してください" },
      { status: 400, headers },
    );
  try {
    return Response.json(
      await searchEntryNodes({
        q: query.get("q") ?? "",
        type,
        theme,
        discipline,
        offset,
      }),
      { headers },
    );
  } catch {
    return Response.json(
      { error: "取得できませんでした" },
      { status: 503, headers },
    );
  }
}
