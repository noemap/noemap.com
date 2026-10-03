import type { Metadata } from "next";
import { isLocalFictional } from "../server/mode";
import "./globals.css";
export const metadata: Metadata = {
  title: "NOEMAP — 人間について考える",
  description: "問いから人物・概念・著作をたどり、考え方と出典を読む。",
  robots: { index: !isLocalFictional(), follow: !isLocalFictional() },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  const local = isLocalFictional();
  return (
    <html lang="ja">
      <body>
        {local ? (
          <div className="local-notice">ローカル確認版・本文と資料は架空例</div>
        ) : null}
        <div className="site-wrap">
          <header className="site-header">
            <a className="brand" href="/">
              NOEMAP
            </a>
            <nav aria-label="主要な案内">
              <a href="/questions">問い</a>
              <a href="/search">探す</a>
              <a href="/timeline">年表</a>
              {local ? <a href="/editor">編集</a> : null}
            </nav>
          </header>
          <main>{children}</main>
          <footer>
            <span>NOEMAP</span>
            <a href="/about">このサイトについて</a>
            <a href="/">人間とは何か？から始める</a>
          </footer>
        </div>
      </body>
    </html>
  );
}
