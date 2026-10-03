import { nodePage } from "../../../../server/exploration";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const result = await nodePage(id);
    return Response.json(result ?? { error: "見つかりません" }, {
      status: result ? 200 : 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json(
      { error: "取得できませんでした" },
      {
        status: 503,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
