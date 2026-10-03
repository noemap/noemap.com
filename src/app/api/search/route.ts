import { searchNodes } from "../../../server/exploration";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const type = query.get("type") || undefined;
  const offset = Number(query.get("offset") ?? "0");
  const headers = { "Cache-Control": "private, no-store" };
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 10000 ||
    (type && !["question", "person", "concept", "work"].includes(type)) ||
    (query.get("q")?.length ?? 0) > 160
  )
    return Response.json(
      { error: "検索条件を確認してください" },
      { status: 400, headers },
    );
  try {
    return Response.json(
      await searchNodes(query.get("q") ?? "", type, offset),
      { headers },
    );
  } catch {
    return Response.json(
      { error: "取得できませんでした" },
      { status: 503, headers },
    );
  }
}
