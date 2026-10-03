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
既存Supabase内に専用領域と初期36項目を登録し、指定された編集者のGoogleログインと本番接続を設定しました。本番でのGoogleログイン・下書き保存・公開反映まで確認済みです。
`.env.example` は空の設定例です。認証情報やバックアップをGitへ保存しないでください。
[接続と復旧の手順](docs/26-persistent-database.md)を参照してください。

```sh
npm run test:persistent
npm run db:prepare
```

ローカルの架空データを使う編集確認は `npm run dev:local` で起動します。
`/editor` はその確認専用で、本番では利用できません。

## 入口・テーマ・学問分野を増やす

今回の入口仕様は [引き継ぎ書](docs/27-entry-design-handoff.md)、実装と残る項目は [確認記録](docs/28-entry-design-implementation.md) を参照してください。本番への反映は別途指示を受けて行います。

入口の共通データは `src/data/entry-catalog.json` です。本文・題名・URL・公開状態はここへコピーせず、既存記事の変更されない **node UUID** を参照します。`revision_id` は参照に使いません。記事が撤回された場合、入口・概要リンク・読書ルート・検索・サイトマップも現在の公開データから除外されます。

1. **テーマ**: `themes` に一意の `id` と `slug`、題名、短い表示名、身近な問い、アイコン、順番を設定します。ホームに表示する場合は `showOnHome: true`。今回のホームは8テーマを保ち、学問分野の追加でカード数を増やしません。
2. **小テーマ**: `groups` に一意の `id`、題名、所属する `themeIds`、`questionIds`、テーマごとの並び順 `orderByTheme` を設定します。概要リンクには公開済みの問いの `overviewNodeId` を使います。公開できる問いがないグループは表示されません。
3. **記事**: `/manage` で出典と参照箇所を伴う記事を下書き保存し、既存の検証を通して公開します。入口に加える際は公開ノードの UUID を `classifications` に登録し、`themeIds`、`disciplineIds`、実際の編集日 `updatedAt` を設定します。同じ UUID を複数テーマの `questionIds` に指定しても記事とURLは一つです。現段階の分類と更新日はGit管理です。本文編集時にもこの日付を更新してください。管理画面での自動連動は今後の課題です。
4. **学問分野**: `disciplines` に一意の `id` と題名を追加し、記事の `disciplineIds` に付けます。心理学・宗教学などの分類を追加しても入口の「大テーマ→小テーマ→記事」は変わりません。分野の登録だけでは記事は増えません。
5. **関連関係**: `/manage/relationships` で公開記事同士を結び、関係の理由と根拠を登録します。歴史的な影響を資料なしに設定しません。ホームと記事に表示する編集上の読書順は `routes` の `nodeIds` と説明に設定します。読書順と歴史的関係は区別します。構成する記事が一つでも公開対象外なら、その読書ルート全体を表示しません。
6. **出典と公開**: 下書きは公開検索・一覧・マップ・URLに出ません。出典撤回時は依存記事と証拠も同じ公開処理で除外されます。現在の公開36項目はオンライン資料を照合した要約で、人による審査は未完了です。参考HTMLの仮本文を公開データへ移さないでください。

`content-release/` は出典を照合した初期公開データ、`tests/fixtures/` とローカル編集確認は架空データです。プレビューに本番DB設定がない場合は照合済み初期公開データを表示します。本番DBに接続している場合、障害時に古いファイルへ切り替えることはありません。

追加・変更後は次を実行します。重複ID・slug、参照の欠落、問い以外を末端に指定した誤り、公開対象外の混入を確認できます。

```sh
npm run test:entry
npm run test:release
npm run test:editor
npm run typecheck
npm run build
npm start -- --hostname 127.0.0.1 --port 4330
# 別の端末で実行（別ポートなら NOEMAP_TEST_ORIGIN を指定）
npm run test:entry:http
```

新しい分野の記事を公開する際は、現状の記事数・準備済みテーマを前提にした試験も実際の公開データに合わせて更新します。受入確認では320・390・768・1280pxの入口と記事、3タップ以内の移動、ブラウザーの戻る操作、個別URLの更新を実ブラウザーで確認します。
