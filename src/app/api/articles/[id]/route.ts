import { article } from "../../../../server/public";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const data = await article(id);
    return Response.json(data ?? { message: "記事を取得できません。" }, {
      status: data ? 200 : 404,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { message: "現在、公開状態を確認できません。" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
