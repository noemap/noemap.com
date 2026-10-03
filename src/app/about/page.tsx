import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "このサイトについて — NOEMAP",
  description:
    "NOEMAPは、問い・人物・概念・著作のつながりから考え方を探るサイトです。",
};

export default function AboutPage() {
  return (
    <article className="about-page">
      <p className="eyebrow">ABOUT NOEMAP</p>
      <h1>このサイトについて</h1>
      <p className="about-lead">問いから、考え方のつながりをたどる。</p>
      <p>
        「人間とは何か？」「自分とは何か？」「知るとはどういうことか？」。
        NOEMAPは、こうした問いを入口に、人物・概念・著作を行き来しながら、
        いろいろな考え方に出会うためのサイトです。
      </p>
      <section>
        <h2>ひとつの問いから、次の問いへ</h2>
        <p>
          気になる問いを開くと、その問いに関わる人物や概念、著作が見つかります。
          説明を読んで、関係図や一覧から次のページへ。
          ひとつの答えに急いでたどり着くより、考え方の違いや共通点を見つけることを大切にしています。
        </p>
      </section>
      <section>
        <h2>気になるところから始める</h2>
        <div className="about-entrances">
          <a href="/questions">
            <strong>問いから</strong>
            <span>いま気になる疑問を選ぶ</span>
          </a>
          <a href="/search">
            <strong>名前や言葉から</strong>
            <span>人物・概念・著作を探す</span>
          </a>
          <a href="/timeline">
            <strong>年表から</strong>
            <span>著作が生まれた時期をたどる</span>
          </a>
        </div>
      </section>
      <section>
        <h2>説明の先に、出典がある</h2>
        <p>
          各ページの説明は、資料をもとにまとめた要約です。
          記述やつながりに添えられた出典を開くと、参照した資料や箇所、
          その説明が当てはまる範囲を確認できます。
          同じ言葉でも、人物や著作によって意味が異なることがあります。
          気になった説明は、出典や関連する著作とあわせて読んでみてください。
        </p>
      </section>
      <p className="about-start">
        <a className="root-button" href="/questions">
          問いを見てみる <span aria-hidden="true">→</span>
        </a>
      </p>
    </article>
  );
}
