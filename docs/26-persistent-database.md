# 永続DBと編集画面の準備

2026-10-03、ユーザーが指定した既存Supabase「nikotaro」にNOEMAP専用領域を作成し、公開中の実資料36項目を登録した。無料プロジェクト数を増やさず、他サイトのテーブル・契約は変更していない。指定された既存Googleログインの本人にNOEMAPの編集権限を登録し、Vercelには本番だけの公開URL・公開キーを保存した。既存のnikotaro用URLを保持し、NOEMAPのGoogleログインの戻り先を追加した。本番再配置後の確認を進めている。

公開用の `public.noemap_public_release` と、非公開の `noemap_private` を使う。公開用JSONがアプリの可視性処理と一致すること、匿名の読み取り、非公開領域の読み取り拒否、匿名の管理RPC・直接更新拒否、未登録の認証利用者の管理RPC拒否を実DBで確認した。

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

現在は上記の1〜6と匿名・未登録・指定編集者のDB権限検査が完了している。Googleログインの戻り先追加も完了し、7は本番再配置後に確認する。ブラウザーの本人ログイン・実際の保存操作は、SQLでの権限検査とは別に確認する。

Supabase Advisorも実施した。NOEMAPの非公開4テーブルは意図的にRLSを有効にして直接アクセスを全拒否しているため、ポリシーなしのINFOが出る。権限付き内部関数からのみ操作する。現在版・下書き・公開版の外部キーはそれぞれ1行の状態テーブルで参照するため、追加索引なしのINFOを許容する。既存サイトの関数・認証・ポリシーの警告は、今回のNOEMAP追加前から存在し、他サイトの動作を変えず別途確認する。

Advisor参照: [非公開テーブルのRLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)、[外部キー索引](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys)、[関数のsearch_path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)、[匿名の特権関数](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)、[認証済み利用者の特権関数](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)、[パスワード保護](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)。

`.env.example` は空の設定例。両方とも未設定なら既存ファイル版を維持する。片方だけの設定や空文字でDBモードを有効にしない。

## 復旧と検証の範囲

編集履歴からの復元は、現在のDB内での内容の戻し作業。管理画面のJSONダウンロードは現在の公開版・下書きを保存するためのもので、すべての履歴を含むDB全体のバックアップではない。自動バックアップやPITRの契約は追加していない。

DBを失った場合は、`node scripts/prepare-persistent-database.mjs --backup バックアップJSONのパス` で復旧SQLをローカルに作成する。保存先が空であることを確認してから適用する。既存データの上書きは拒否し、公開版の撤回を下書きにも維持する。編集者の権限、過去の全履歴、認証ユーザーはこのJSONから作成しない。

## NOEMAPを独立プロジェクトへ移すとき

共有プロジェクト全体の移転は他サイトも含む。NOEMAPだけを独立させる場合は、NOEMAP専用データを新しい空のDBへ移す。

1. NOEMAPの編集を一時停止し、公開版・下書き・撤回記録の控えを取る。全履歴が必要なら、管理画面のJSONだけでなく `noemap_private.snapshots`、状態、操作記録も保存する。
2. NOEMAPのデータだけを扱う移行を行う。共有Authの全ユーザーや他サイトのテーブルを一括コピーしない。編集者アカウントを移す場合は本人の同意と指定を確認し、`created_by`、`user_id`、`actor_id` の参照を新しい認証IDへ対応付ける。
3. 専用スキーマの移行SQLと公開用テーブル・6つの `noemap_` RPCを新DBへ配置する。データ・版ID・編集履歴・撤回記録を移し、公開用の射影を確認する。ファイルを保存する機能を追加した場合は、Storageの実ファイルも別途移す。
4. 元DBと移行先で項目数、全履歴数、版ID、内容のハッシュ、閲覧・編集権限を照合する。復元した過去版から撤回済み内容が再公開されないことも確認する。
5. Vercelの本番接続先を移行先のURL・公開キーへ変更し、再配置する。表示・ログイン・保存・公開・復元を確認してから編集を再開する。
6. 元の専用領域は、移行先と復旧用控えを確認するまで保管する。今回、自動削除や有料化は行わない。

この手順の本番移行は未実施。管理画面のJSONは最新内容の復旧用であり、全履歴の移行完了を保証するものではない。公式手順: [バックアップと移行](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)。

ローカルの使い捨てPostgreSQLと架空の認証情報で、アクセス制限、出典ごとの可視性、直接RPCでの不正入力拒否、同時編集、操作の再試行、撤回を維持する復元、DB再起動後のデータ保持を検証した。記録は `docs/validation/persistent-db-results.json`。実DBの権限・Advisor・Vercel本番環境変数の設定は完了。本人のブラウザーログインと本番の保存操作は未確認。

実装に参照した公式資料: [SupabaseのAPIキー](https://supabase.com/docs/guides/getting-started/api-keys)、[Next.jsの認証連携](https://supabase.com/docs/guides/getting-started/tutorials/with-nextjs)、[データの保護](https://supabase.com/docs/guides/database/secure-data)。
