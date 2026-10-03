# NOEMAP

「人間とは何か？」を入口に、問い・人物・概念・著作のつながりをたどるサイトです。
公開サイト: https://noemap.com / 紹介: https://noemap.com/about

## 作業先

このリポジトリ `noemap/noemap.com` を、今後の開発・公開の作業先とします。
旧 `noemap/noemap` の探索MVPと永続DB・編集画面の実装をここへ集約しました。
旧リポジトリの非公開の設計資料とコミット履歴は、旧リポジトリに保管します。
Vercelの本番サイトは、このリポジトリの `main` から配置します。

## 起動と確認

```sh
npm ci
npm run test:release
npm run test:editor
npm run build
npm start
```

実資料に基づく初期36項目は、`content-release/manifest.json` で選定し、資料JSONのハッシュを確認して公開用データを生成します。
出典・帰属・参照箇所・要約の範囲を保持します。人による内容審査は公開後に行う方針で、記録の `human_review` は `pending` です。

## 保存と編集

永続DB用の移行SQL、本人確認付きの編集画面 `/manage`、下書き・公開・履歴・撤回を維持する復元を用意しています。
既存Supabase内に専用領域と初期36項目を登録し、指定された編集者のGoogleログインと本番接続を設定しました。本番再配置後に接続を確認します。
`.env.example` は空の設定例です。認証情報やバックアップをGitへ保存しないでください。
[接続と復旧の手順](docs/26-persistent-database.md)を参照してください。

```sh
npm run test:persistent
npm run db:prepare
```

ローカルの架空データを使う編集確認は `npm run dev:local` で起動します。
`/editor` はその確認専用で、本番では利用できません。
