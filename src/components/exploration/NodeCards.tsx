import { nodeTypeNames, type NodeSummary } from "../../domain/nodes";
export function NodeCards({
  nodes,
  headingLevel = 2,
}: {
  nodes: NodeSummary[];
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <ul className="node-cards">
      {nodes.map((node) => (
        <li key={node.id}>
          <a className="node-card" href={node.href}>
            <span className="type-label">{nodeTypeNames[node.type]}</span>
            <Heading>{node.title}</Heading>
            {node.summary ? <p>{node.summary}</p> : null}
            <span className="node-card-arrow" aria-hidden="true">
              →
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
