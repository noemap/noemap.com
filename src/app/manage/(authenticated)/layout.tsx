import { requireEditor } from "../../../server/manage";
export default async function EditorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const actor = await requireEditor();
  return (
    <>
      <div className="editor-head">
        <nav aria-label="編集画面の案内" className="manage-nav">
          <a href="/manage">項目</a>
          <a href="/manage/relationships">関連</a>
          <a href="/manage/sources">資料</a>
          <a href="/manage/history">履歴・復元</a>
        </nav>
        <form method="post" action="/manage/auth">
          <input type="hidden" name="action" value="logout" />
          <button className="secondary">{actor.label} · 退出</button>
        </form>
      </div>
      <p className="notice">
        人による内容確認は準備中です。下書きの保存と公開への反映は別の操作です。
      </p>
      {children}
    </>
  );
}
