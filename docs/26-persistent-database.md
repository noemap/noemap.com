# 永続DBと編集画面の準備

公開中の実資料36項目を、Supabase PostgreSQLへ移すための実装を用意した。本番の作成先・費用・編集者本人が未確定なので、クラウドDBの作成、他用途DBの変更、認証ユーザーの作成、権限付与、メール送信、本番接続は行っていない。

## 実装した動作

- `/manage` は本人確認とDB上の編集者登録を毎回確認する。新規登録は公開しない。
- 項目、出典付き記述、資料、根拠付きの関係を編集し、理由を添えて下書きへ保存する。公開への反映は別の操作で行う。
- 版の履歴を保持し、復元は新しい下書きとして保存する。過去の版を上書きしない。同時編集は検出し、フォームの入力を残す。
- 出典の撤回は依存する内容も非公開にする。撤回記録を安定した識別子へ正規化し、版更新・復元でも維持する。
- 匿名で読めるDBテーブルは、撤回内容・私的メタデータを除いた公開用JSONだけ。元データ、下書き、編集者登録、操作記録は非公開スキーマに置く。
- DBを設定した後の取得失敗では、以前のファイルへ切り替えない。DB接続を設定していない場合は既存の公開版を使う。
- 人による審査の表示は `pending` のまま。保存や公開を人による内容承認と扱わない。

## 保存先の確定後に行う作業

1. ユーザーが指定したSupabaseプロジェクトを確認する。新規作成の場合は組織と見積費用を確認してから作成する。
2. `supabase/migrations/20261003031858_noemap_persistent_snapshots.sql` を選択された保存先へ適用する。既存の同名領域があれば停止する。旧ローカル用の `db/migrations/001..006` を本番へ混在させない。
3. `node scripts/prepare-persistent-database.mjs` で作った `.local/persistent-initial-import.sql` を適用する。初期データが既に存在する場合はインポートを拒否する。人の承認記録や編集者アカウントは作らない。
4. 本人が指定したログイン用アカウントだけを `noemap_private.editors` に登録する。メール・パスワードをGitHubや公開ファイルへ保存しない。
5. Supabaseのセキュリティ・性能Advisorと、匿名・未登録・編集者の権限を実プロジェクトで検証する。
6. noemap.comのVercelプロジェクトへ `NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` を設定する。公開キー以外は受け付けない。プレビューへ本番DBの書込権限を渡さない。
7. 公開サイトのDB読み取り、本人ログイン、下書き保存、公開反映、撤回と復元を確認して接続を完了する。

`.env.example` は空の設定例。両方とも未設定なら既存ファイル版を維持する。片方だけの設定や空文字でDBモードを有効にしない。

## 復旧と検証の範囲

編集履歴からの復元は、現在のDB内での内容の戻し作業。管理画面のJSONダウンロードは現在の公開版・下書きを保存するためのもので、すべての履歴を含むDB全体のバックアップではない。自動バックアップやPITRの契約は追加していない。

DBを失った場合は、`node scripts/prepare-persistent-database.mjs --backup バックアップJSONのパス` で復旧SQLをローカルに作成する。保存先が空であることを確認してから適用する。既存データの上書きは拒否し、公開版の撤回を下書きにも維持する。編集者の権限、過去の全履歴、認証ユーザーはこのJSONから作成しない。

ローカルの使い捨てPostgreSQLと架空の認証情報で、アクセス制限、出典ごとの可視性、直接RPCでの不正入力拒否、同時編集、操作の再試行、撤回を維持する復元、DB再起動後のデータ保持を検証した。記録は `docs/validation/persistent-db-results.json`。本番Supabase Auth・Advisor・Vercel環境変数の検証は保存先確定後に実施する。

実装に参照した公式資料: [SupabaseのAPIキー](https://supabase.com/docs/guides/getting-started/api-keys)、[Next.jsの認証連携](https://supabase.com/docs/guides/getting-started/tutorials/with-nextjs)、[データの保護](https://supabase.com/docs/guides/database/secure-data)。
