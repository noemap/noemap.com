import Link from "next/link";
import {
  nodeTypeNames,
  type NeighborPage,
  type NodeSummary,
} from "../../domain/nodes";
import styles from "./Reading.module.css";

export interface ReadingRoute {
  id: string;
  title: string;
  description: string;
  nodes: NodeSummary[];
}

interface ReadingCard {
  node: NodeSummary;
  reason: string;
}

const readingPurposes = {
  question: "別の問いから、考えを広げる",
  person: "この人物の考え方をたどる",
  concept: "別の資料の考え方を読む",
  work: "著作から、問いを広げる",
} satisfies Record<NodeSummary["type"], string>;

function uniqueCards(cards: ReadingCard[]) {
  const seen = new Set<string>();
  return cards.filter((card) => {
    if (seen.has(card.node.id)) return false;
    seen.add(card.node.id);
    return true;
  });
}

export function questionPerspectives(
  node: NodeSummary,
  neighbors: NeighborPage,
  routes: ReadingRoute[],
) {
  if (node.type !== "question") return [];
  const direct = neighbors.items
    .filter((item) => item.node.type === "concept")
    .map((item) => ({ node: item.node, reason: item.reason }));
  const reading = routes.flatMap((route) =>
    route.nodes
      .filter((item) => item.type === "concept" && item.id !== node.id)
      .map((item) => ({ node: item, reason: readingPurposes.concept })),
  );
  return uniqueCards([...direct, ...reading]).slice(0, 3);
}

function ReadingCardLink({ card }: { card: ReadingCard }) {
  return (
    <Link className={styles.card} href={card.node.href} prefetch={false}>
      <span className={styles.cardType}>{nodeTypeNames[card.node.type]}</span>
      <span className={styles.cardTitle}>
        {card.node.title}
        <span className={styles.cardArrow} aria-hidden="true">
          ↗
        </span>
      </span>
      <span className={styles.cardSummary}>{card.node.summary}</span>
      <span className={styles.cardReason}>
        {card.reason || readingPurposes[card.node.type]}
      </span>
    </Link>
  );
}

export function QuestionPerspectives({ cards }: { cards: ReadingCard[] }) {
  if (!cards.length) return null;
  return (
    <section
      className={styles.perspectives}
      id="reading-perspectives"
      aria-labelledby="reading-perspectives-title"
    >
      <span className={styles.eyebrow}>考え方への入口</span>
      <h2 id="reading-perspectives-title">この問いの見方</h2>
      <p className={styles.sectionIntroduction}>
        ひとつの答えを急がず、考え方をひとつずつ見てみる。
      </p>
      <div className={styles.cardGrid}>
        {cards.map((card) => (
          <ReadingCardLink card={card} key={card.node.id} />
        ))}
      </div>
    </section>
  );
}

export function ReadingContinuation({
  node,
  neighbors,
  routes,
  perspectiveIds,
}: {
  node: NodeSummary;
  neighbors: NeighborPage;
  routes: ReadingRoute[];
  perspectiveIds: Set<string>;
}) {
  const routeNodes = routes.flatMap((route) =>
    route.nodes
      .filter((item) => item.id !== node.id && !perspectiveIds.has(item.id))
      .map((item) => ({ node: item, reason: readingPurposes[item.type] })),
  );
  const direct = neighbors.items
    .filter((item) => !perspectiveIds.has(item.node.id))
    .map((item) => ({ node: item.node, reason: item.reason }));
  const cards = uniqueCards([...direct, ...routeNodes]).slice(0, 4);
  if (!cards.length) return null;
  return (
    <section
      className={styles.continuation}
      id="reading-next"
      aria-labelledby="reading-next-title"
    >
      <span className={styles.eyebrow}>気になった先へ</span>
      <h2 id="reading-next-title">次の発見へ</h2>
      <p className={styles.sectionIntroduction}>
        ひとつのページから、また別の考え方へ。気になったつながりから、続きをどうぞ。
      </p>
      <div className={styles.cardGrid}>
        {cards.map((card) => (
          <ReadingCardLink card={card} key={card.node.id} />
        ))}
      </div>
      {routes.map((route) => (
        <p className={styles.routeNote} key={route.id}>
          <strong>{route.title}</strong>
          <span>{route.description}</span>
        </p>
      ))}
    </section>
  );
}
