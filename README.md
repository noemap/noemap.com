# NOEMAP

https://noemap.com の公開用リポジトリです。

ヒューム・ロック・デカルトの原典に基づく36項目、38の記述、38の編集関係、5件の出典付き刊行情報を、問い・人物・概念・著作のページで探索できます。人による内容審査は公開後に行う方針で、サイトと公開データに確認待ちの状態を示します。

初期公開は版を固定した読み取り専用データです。DB接続や秘密の環境変数は不要で、本番ではローカル用の編集ログインと書き込みを停止します。制作元は content-review、公開対象とハッシュは content-release/manifest.json です。資料の全文は格納・転載しません。

```sh
npm ci
npm run test:content
npm run test:release
npm run build
npm start
```

VercelのGit連携でmainを公開します。訂正・撤回・復旧は [運用手順](docs/25-first-public-release.md) に記載しています。

実装の開発履歴は [noemap/noemap PR #2](https://github.com/noemap/noemap/pull/2) に保存しています。この公開版の元コミットは b84656c3e1a89abb42186280f0847fb047978a6d です。

永続DB・本番の編集者認証・大量データの性能検証は次工程です。
