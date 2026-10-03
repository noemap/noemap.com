import { readEditor, manageStatusNames } from "../../../../server/manage";
export default async function History() {
  const state = await readEditor();
  return (
    <>
      <h1>保存した版と復元</h1>
      <section className="panel">
        <h2>最新の公開版と下書きのデータ控え</h2>
        <p>
          項目・出典・撤回情報と版の識別子を含むJSONを保存します。過去の版は下の履歴から復元できます。
        </p>
        <a className="button secondary" href="/manage/export">
          最新の公開版と下書きを保存（JSON）
        </a>
      </section>
      <p>
        過去の版を編集し直さず、新しい下書きとして復元します。現在撤回している資料の指定は復元後も維持します。
      </p>
      <section className="panel">
        {state.history.map((item) => (
          <div className="list-row" key={item.id}>
            <div>
              <a href={`/manage/history/${encodeURIComponent(item.id)}`}>
                {item.reason || "保存された版"}
              </a>
              <p className="editor-meta">
                {item.actor_label} ·{" "}
                <time dateTime={item.created_at}>
                  {new Date(item.created_at).toLocaleString("ja-JP", {
                    timeZone: "Asia/Tokyo",
                  })}
                </time>
              </p>
            </div>
            <span className="status">
              {item.id === state.current.id
                ? "現在の公開版"
                : item.id === state.draft?.id
                  ? "現在の下書き"
                  : (manageStatusNames[item.status] ?? "保存版")}
            </span>
          </div>
        ))}
        {!state.history.length ? <p>保存した版はまだありません。</p> : null}
      </section>
    </>
  );
}
