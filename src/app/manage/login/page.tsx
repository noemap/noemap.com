import { redirect } from "next/navigation";
import { authenticatedEditor } from "../../../server/manage";
import { supabaseConfiguration } from "../../../server/supabase-config";
import { isLocalFictional } from "../../../server/mode";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const configured = Boolean(supabaseConfiguration()) && !isLocalFictional();
  if (configured) {
    try {
      if (await authenticatedEditor()) redirect("/manage");
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("NEXT_REDIRECT"))
        throw error;
    }
  }
  const query = await searchParams;
  return (
    <section className="panel login-panel">
      <h1>編集者のログイン</h1>
      <p>登録された編集者だけが内容を編集できます。</p>
      {configured ? (
        <>
          {query.error ? (
            <p className="notice warning" role="alert">
              ログインできませんでした。登録されたアカウントで再度お試しください。
            </p>
          ) : null}
          <form method="post" action="/manage/auth">
            <input type="hidden" name="action" value="google" />
            <button type="submit">Googleでログイン</button>
          </form>
          <details>
            <summary>メールアドレスとパスワードでログイン</summary>
            <form method="post" action="/manage/auth">
              <input type="hidden" name="action" value="login" />
              <label htmlFor="manage-email">メールアドレス</label>
              <input
                id="manage-email"
                name="email"
                type="email"
                autoComplete="username"
                required
                maxLength={254}
              />
              <label htmlFor="manage-password">パスワード</label>
              <input
                id="manage-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={1024}
              />
              <button type="submit">ログイン</button>
            </form>
          </details>
          <p className="field-note">
            アカウントの登録と編集権限は運営者が設定します。
          </p>
        </>
      ) : (
        <p className="notice">
          本番の編集用接続はまだ設定されていません。公開中の内容は引き続き閲覧できます。
        </p>
      )}
      <a href="/">公開ページへ戻る →</a>
    </section>
  );
}
