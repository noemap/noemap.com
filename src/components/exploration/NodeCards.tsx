import { nodeTypeNames, type NodeSummary } from "../../domain/nodes";
import { EntranceArticleLink } from "../entry/EntranceArticleLink";
export function NodeCards({
  nodes,
  headingLevel = 2,
  rememberEntrance = false,
}: {
  nodes: NodeSummary[];
  headingLevel?: 2 | 3;
  rememberEntrance?: boolean;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <ul className="node-cards">
      {nodes.map((node) => {
        const content = (
          <>
            <span className="type-label">{nodeTypeNames[node.type]}</span>
            <Heading>{node.title}</Heading>
            {node.summary ? <p>{node.summary}</p> : null}
            <span className="node-card-arrow" aria-hidden="true">
              ↗
            </span>
          </>
        );
        return (
          <li key={node.id}>
            {rememberEntrance ? (
              <EntranceArticleLink
                className="node-card"
                href={node.href}
                nodeId={node.id}
              >
                {content}
              </EntranceArticleLink>
            ) : (
              <a className="node-card" href={node.href}>
                {content}
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
