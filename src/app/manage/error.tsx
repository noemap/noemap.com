"use client";
export default function ManageErrorBoundary({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="panel">
      <h1>編集データを読み込めませんでした</h1>
      <p>接続を確認して、もう一度開いてください。</p>
      <div className="actions">
        <button type="button" onClick={reset}>
          もう一度読み込む
        </button>
        <a className="button secondary" href="/manage/login">
          ログイン画面へ
        </a>
      </div>
    </section>
  );
}
