"use client";
export default function ErrorPage() {
  return (
    <div className="empty">
      <h1>現在、記事を取得できません</h1>
      <p>公開状態を確認できないため、内容を表示できません。</p>
      <button onClick={() => window.location.reload()}>もう一度取得する</button>
    </div>
  );
}
