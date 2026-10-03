import {
  nodeTypeNames,
  type NodeSummary,
  type NeighborPage,
} from "../../domain/nodes";
import { Pagination } from "../exploration/Pagination";
function nameLines(name: string) {
  const chars = Array.from(name);
  return [
    chars.slice(0, 10).join(""),
    chars.length > 10
      ? `${chars.slice(10, 20).join("")}${chars.length > 20 ? "…" : ""}`
      : "",
  ];
}
export function Neighborhood({
  node,
  page,
  pagination = true,
}: {
  node: NodeSummary;
  page: NeighborPage;
  pagination?: boolean;
}) {
  if (!page.items.length && !page.offset) return null;
  const visible = Array.from(
    new Map(page.items.map((item) => [item.node.id, item])).values(),
  ).slice(0, 6);
  const titleId = `neighborhood-${node.id}`;
  const centerLines = nameLines(node.title);
  return (
    <section className="panel neighborhood" id="connections">
      <h2>つながりをたどる</h2>
      {visible.length ? (
        <svg
          viewBox={`0 0 440 ${210 + (Math.ceil(visible.length / 2) - 1) * 88}`}
          className="neighborhood-map"
          aria-labelledby={titleId}
          role="group"
        >
          <title id={titleId}>{`${node.title}からたどれる知識`}</title>
          <desc>
            名称を選ぶとその項目へ移動します。すべての名前と関係の理由は図の下にあります。
          </desc>
          {visible.map((item, index) => {
            const left = index % 2 === 0;
            const x = left ? 104 : 336;
            const y = 152 + Math.floor(index / 2) * 88;
            const [first, second] = nameLines(item.node.title);
            return (
              <g key={item.node.id}>
                <path
                  d={`M220 78 Q220 ${y} ${x} ${y}`}
                  stroke="var(--line)"
                  strokeWidth="2"
                  fill="none"
                />
                <a
                  href={item.node.href}
                  aria-label={`${item.node.title}のページへ`}
                  className="graph-node-link"
                >
                  <rect
                    x={left ? 8 : 240}
                    y={y - 30}
                    width="192"
                    height="64"
                    rx="9"
                    fill="var(--paper)"
                    stroke="var(--green)"
                  />
                  <text
                    x={x}
                    y={second ? y - 3 : y + 6}
                    textAnchor="middle"
                    fill="var(--ink)"
                    fontSize="16"
                  >
                    <tspan x={x}>{first}</tspan>
                    {second ? (
                      <tspan x={x} dy="21">
                        {second}
                      </tspan>
                    ) : null}
                  </text>
                </a>
              </g>
            );
          })}
          <a
            href={node.href}
            aria-label={`${node.title}のページへ`}
            className="graph-node-link"
          >
            <rect
              x="112"
              y="10"
              width="216"
              height="68"
              rx="10"
              fill="var(--green)"
            />
            <text
              x="220"
              y={centerLines[1] ? 38 : 50}
              textAnchor="middle"
              fill="var(--paper)"
              fontSize="17"
            >
              <tspan x="220">{centerLines[0]}</tspan>
              {centerLines[1] ? (
                <tspan x="220" dy="22">
                  {centerLines[1]}
                </tspan>
              ) : null}
            </text>
          </a>
        </svg>
      ) : (
        <p>このページに表示できるつながりはありません。</p>
      )}
      <ul className="neighbor-list">
        {page.items.map((item) => (
          <li key={item.id}>
            <span className="type-label">{nodeTypeNames[item.node.type]}</span>
            <a className="neighbor-name" href={item.node.href}>
              {item.node.title}
            </a>
            <span className="relation-label">{item.label}</span>
            {item.reason ? <p>{item.reason}</p> : null}
            <a className="relation-evidence" href={`/evidence/${item.id}`}>
              つながりの根拠を読む
            </a>
          </li>
        ))}
      </ul>
      {pagination ? (
        <Pagination
          pathname={node.href}
          offset={page.offset}
          hasMore={page.has_more}
          fragment="#connections"
        />
      ) : null}
    </section>
  );
}
