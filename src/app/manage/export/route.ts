import { authenticatedEditor, readEditor } from "../../../server/manage";
import { createDatasetBackup } from "../../../domain/manage-backup";
export const dynamic = "force-dynamic";
const responseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow",
};
export async function GET() {
  try {
    if (!(await authenticatedEditor()))
      return new Response("編集者のログインが必要です。", {
        status: 403,
        headers: responseHeaders,
      });
    const state = await readEditor();
    return new Response(JSON.stringify(createDatasetBackup(state), null, 2), {
      headers: {
        ...responseHeaders,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="noemap-backup.json"',
      },
    });
  } catch {
    return new Response(
      "データの控えを作成できませんでした。接続と内容を確認してから再度お試しください。",
      { status: 503, headers: responseHeaders },
    );
  }
}
