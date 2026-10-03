import { timelineNodes } from "../../../server/exploration";

export async function GET(request: Request) {
  const offset = Number(new URL(request.url).searchParams.get("offset") ?? "0");
  const headers = { "Cache-Control": "private, no-store" };
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000)
    return Response.json(
      { error: "表示条件を確認してください" },
      { status: 400, headers },
    );
  try {
    return Response.json(await timelineNodes(offset), { headers });
  } catch {
    return Response.json(
      { error: "取得できませんでした" },
      { status: 503, headers },
    );
  }
}
