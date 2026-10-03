import { connection } from "next/server";
import { redirect } from "next/navigation";
import { session } from "../../../server/session";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await connection();
  if (await session()) redirect("/editor");
  const query = await searchParams;
  return (
    <div className="panel login-panel">
      <h1>編集画面に入る</h1>
      <p className="muted">ローカルの動作確認用アカウントを使います。</p>
      {query.error && (
        <p className="notice warning">
          入力内容を確認してください。連続して失敗した場合は、1分待ってから再度お試しください。
        </p>
      )}
      <form method="post" action="/editor/auth">
        <label htmlFor="account">アカウント</label>
        <select name="account" id="account">
          <option value="owner">運営者</option>
          <option value="writer">執筆者</option>
          <option value="checker">確認者</option>
        </select>
        <label htmlFor="password">パスワード</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={200}
        />
        <div className="actions">
          <button>入る</button>
        </div>
      </form>
      <p className="field-note">
        起動時に作成される .local/editor-login.txt
        に、今回の確認用パスワードがあります。
      </p>
    </div>
  );
}
