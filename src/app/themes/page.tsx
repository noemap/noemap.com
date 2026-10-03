import type { Metadata } from "next";
import { connection } from "next/server";
import { publicEntryData } from "../../server/entry";
import { ThemeIcon } from "../../components/entry/ThemeIcon";
export const metadata: Metadata = {
  title: "テーマから探す — NOEMAP",
  description: "からだ・こころ・自分・社会など、人間について考える八つの入口。",
  alternates: { canonical: "https://noemap.com/themes" },
};
export default async function Themes() {
  await connection();
  const { themes } = await publicEntryData();
  return (
    <>
      <div className="exploration-heading">
        <h1>テーマから考える</h1>
        <p>何を知りたいか、気になる入口を選んでください。</p>
      </div>
      <div className="theme-list">
        {themes.map((t) => (
          <article key={t.id} className="theme-list-card">
            <ThemeIcon name={t.icon} />
            <h2>{t.title}</h2>
            <p>{t.prompt}</p>
            {t.groups.length ? (
              <a href={`/themes/${t.slug}`}>このテーマをたどる →</a>
            ) : (
              <p className="muted small">
                準備中 · 公開できる問いを整えています。
              </p>
            )}
          </article>
        ))}
      </div>
    </>
  );
}
