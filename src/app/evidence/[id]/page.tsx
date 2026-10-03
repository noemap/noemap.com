import { connection } from "next/server";
import { notFound } from "next/navigation";
import { evidence } from "../../../server/public";
import { roleNames } from "../../../domain/types";
const evidenceRoleNames: Record<string, string> = {
  support: "記述を支える資料",
  supports: "記述を支える資料",
  qualification: "留保・補足の資料",
  qualifies: "留保・補足の資料",
  counter: "反対根拠の資料",
  opposes: "反対根拠の資料",
};
function httpsSourceUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export default async function Evidence({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const { id } = await params;
  const data = await evidence(id);
  if (!data) notFound();
  return (
    <div className="evidence-page">
      <span className="type-label">根拠</span>
      <h1>記述と出典</h1>
      <section>
        <h2>記述の内容</h2>
        <p>{data.texts.find((t) => t.role === "body")?.content}</p>
      </section>
      {data.attributions.length > 0 && (
        <section>
          <h2>誰の説明か</h2>
          {data.attributions.map((a, i) => (
            <div key={i}>
              <p>
                {a.speaker}{" "}
                <span className="badge">{roleNames[a.role] ?? a.role}</span>
              </p>
              {a.context && <p className="muted">{a.context}</p>}
            </div>
          ))}
        </section>
      )}
      <section>
        <h2>資料の該当箇所</h2>
        {data.sources.map((s, i) => {
          const url = httpsSourceUrl(s.url);
          return (
            <div
              className="source-card"
              key={`${s.source_revision_id}:${s.locator}:${i}`}
            >
              <p className="relation-label">
                {evidenceRoleNames[s.role] ?? "参照資料"}
              </p>
              <p>{s.citation}</p>
              <dl>
                <dt>位置</dt>
                <dd>{s.locator}</dd>
                <dt>版</dt>
                <dd>{s.edition ?? "書誌を参照"}</dd>
              </dl>
              {url ? (
                <a className="source-link" href={url} rel="noopener noreferrer">
                  資料の掲載元を読む →
                </a>
              ) : null}
            </div>
          );
        })}
        {data.basis.length > 0 && (
          <>
            <p>この接続は、以下の記述をもとにした編集上の関連付けです。</p>
            <ul>
              {data.basis.map((b) => (
                <li key={b}>
                  <a href={`/evidence/${b}`}>比較に使った記述と出典</a>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
