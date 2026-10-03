import { createHash } from "node:crypto";
import type {
  NodeDocument,
  NodeSummary,
  NodePage,
  NeighborPage,
  TimelineRecord,
  TimelinePage,
  NodeType,
} from "./nodes";
import type { Article, CatalogItem, PublicEvidence } from "./types";

interface EvidenceInput {
  source: string;
  locator: string;
  role: string;
}
interface NodeInput {
  id: string;
  type: string;
  label: string;
  summary_ja: string;
  aliases?: string[];
  nature?: string;
  evidence?: EvidenceInput[];
  basis?: string[];
  definition_scope?: string;
  scope_limit?: string;
}
interface SourceInput {
  id: string;
  title: string;
  edition: string;
  url: string;
  author?: string;
  host?: string;
}
interface AssertionInput {
  id: string;
  subject: string;
  nature: string;
  attribution: string;
  text_ja: string;
  limit: string;
  evidence: EvidenceInput[];
  basis?: string[];
}
interface RelationshipInput {
  id?: string;
  from: string;
  to: string;
  nature: string;
  reason: string;
  basis: string[];
}
interface BatchInput {
  batch_id: string;
  node_candidates: NodeInput[];
  sources: SourceInput[];
  assertion_candidates: AssertionInput[];
  relationship_candidates: RelationshipInput[];
}
interface TemporalInput {
  id: string;
  node_id: string;
  role: string;
  date_label: string;
  original_label: string;
  calendar: string;
  normalization: string;
  precision: string;
  start_earliest: number | null;
  start_latest: number | null;
  end_earliest: number | null;
  end_latest: number | null;
  evidence: EvidenceInput[];
  text_ja: string;
  limit: string;
}
export interface ProvisionalReleaseInput {
  schema_version: number;
  release_id: string;
  publication_status: string;
  human_review: {
    status: string;
    reviewer: string | null;
    approved_at: string | null;
  };
  authorized_by: string;
  batches: BatchInput[];
  withdrawn: {
    sources: string[];
    nodes: string[];
    assertions: string[];
    relationships: string[];
  };
  temporal_records: TemporalInput[];
}

const collections: Record<NodeType, string> = {
  question: "questions",
  person: "people",
  concept: "concepts",
  work: "books",
};
const nodeTypes = new Set(Object.keys(collections));
const evidenceRoles = new Set(["support", "qualification", "counter"]);
const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const normalized = (value: string) => value.normalize("NFKC").toLowerCase();
const validOffset = (value: number) =>
  Number.isSafeInteger(value) && value >= 0 && value <= 10000;
const relationKey = (relation: RelationshipInput) =>
  relation.id ?? `${relation.from}->${relation.to}`;

// Stable object identities survive release updates. Version identities include the
// immutable release ID. The format stays compatible with the existing UUID API.
function uuid(key: string) {
  const bytes = createHash("sha256")
    .update(`noemap/provisional/${key}`)
    .digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createProvisionalRelease(input: ProvisionalReleaseInput) {
  // Capture one release snapshot; caller mutations cannot mix old/new datasets.
  const release = structuredClone(input);
  const check = (condition: unknown, message: string) => {
    if (!condition) throw new Error(`Invalid provisional release: ${message}`);
  };
  check(release.schema_version === 1 && text(release.release_id), "version");
  check(release.publication_status === "provisional", "publication status");
  check(
    release.human_review?.status === "pending" &&
      release.human_review.reviewer === null &&
      release.human_review.approved_at === null,
    "human review must remain pending",
  );
  check(release.authorized_by === "project-owner-request", "authorization");
  check(Array.isArray(release.batches) && release.batches.length, "batches");
  for (const category of [
    "sources",
    "nodes",
    "assertions",
    "relationships",
  ] as const)
    check(
      Array.isArray(release.withdrawn?.[category]),
      `withdrawn ${category}`,
    );
  check(Array.isArray(release.temporal_records), "temporal records");

  const objectId = (kind: string, key: string) => uuid(`object/${kind}/${key}`);
  const revisionId = (kind: string, key: string) =>
    uuid(`revision/${release.release_id}/${kind}/${key}`);
  const nodes = new Map<string, NodeInput>();
  const sources = new Map<string, SourceInput>();
  const claims = new Map<string, AssertionInput>();
  const relations = new Map<string, RelationshipInput>();
  const relationAliases = new Map<string, string>();
  const allIds = new Set<string>();
  function add<T extends { id: string }>(map: Map<string, T>, item: T) {
    check(
      text(item.id) && !allIds.has(item.id),
      `duplicate or missing ID ${item.id}`,
    );
    allIds.add(item.id);
    map.set(item.id, item);
  }
  for (const batch of release.batches) {
    for (const node of batch.node_candidates) add(nodes, node);
    for (const source of batch.sources) add(sources, source);
    for (const claim of batch.assertion_candidates) add(claims, claim);
    for (const [index, relation] of batch.relationship_candidates.entries()) {
      const key = relation.id ?? `${batch.batch_id}:relation:${index}`;
      check(!relations.has(key), `duplicate relation ${key}`);
      relations.set(key, relation);
      relationAliases.set(`${relation.from}->${relation.to}`, key);
    }
  }
  function validateEvidence(
    evidence: EvidenceInput[] | undefined,
    owner: string,
  ) {
    check(Array.isArray(evidence) && evidence.length, `evidence ${owner}`);
    for (const item of evidence ?? [])
      check(
        sources.has(item.source) &&
          text(item.locator) &&
          evidenceRoles.has(item.role),
        `evidence reference ${owner}`,
      );
  }
  function validateBasis(basis: string[] | undefined, owner: string) {
    check(Array.isArray(basis) && basis.length, `basis ${owner}`);
    for (const id of basis ?? [])
      check(claims.has(id), `basis reference ${owner}`);
  }
  for (const source of sources.values()) {
    let https = false;
    try {
      const url = new URL(source.url);
      https = url.protocol === "https:" && !url.username && !url.password;
    } catch {
      /* Invalid URLs fail closed. */
    }
    check(
      text(source.title) && text(source.edition) && https,
      `source ${source.id}`,
    );
  }
  for (const node of nodes.values()) {
    check(
      nodeTypes.has(node.type) &&
        text(node.label) &&
        text(node.summary_ja) &&
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(node.id) &&
        node.id.length <= 96,
      `node ${node.id}`,
    );
    if (node.type === "concept")
      check(text(node.definition_scope), `scope ${node.id}`);
    if (node.nature === "editorial") validateBasis(node.basis, node.id);
    else validateEvidence(node.evidence, node.id);
    if (node.evidence?.length) validateEvidence(node.evidence, node.id);
    if (node.basis?.length) validateBasis(node.basis, node.id);
  }
  for (const claim of claims.values()) {
    check(
      nodes.has(claim.subject) &&
        text(claim.text_ja) &&
        text(claim.limit) &&
        text(claim.attribution),
      `claim ${claim.id}`,
    );
    validateEvidence(claim.evidence, claim.id);
    if (claim.basis?.length) validateBasis(claim.basis, claim.id);
  }
  for (const [key, relation] of relations) {
    check(
      nodes.has(relation.from) &&
        nodes.has(relation.to) &&
        relation.from !== relation.to &&
        relation.nature === "editorial" &&
        text(relation.reason),
      `relation ${key}`,
    );
    validateBasis(relation.basis, key);
  }
  for (const date of release.temporal_records) {
    check(
      !allIds.has(date.id) &&
        text(date.id) &&
        nodes.has(date.node_id) &&
        ["birth", "death", "active", "publication", "founding"].includes(
          date.role,
        ) &&
        date.normalization === "astronomical_year" &&
        date.precision === "year" &&
        text(date.date_label) &&
        text(date.original_label) &&
        text(date.calendar) &&
        text(date.text_ja) &&
        text(date.limit),
      `date ${date.id}`,
    );
    allIds.add(date.id);
    for (const year of [
      date.start_earliest,
      date.start_latest,
      date.end_earliest,
      date.end_latest,
    ])
      check(
        year === null ||
          (Number.isSafeInteger(year) &&
            year >= -2147483648 &&
            year <= 2147483647),
        `date year ${date.id}`,
      );
    const ordered = (first: number | null, last: number | null) =>
      first === null || last === null || first <= last;
    check(
      ordered(date.start_earliest, date.start_latest) &&
        ordered(date.end_earliest, date.end_latest) &&
        ordered(date.start_earliest, date.end_latest) &&
        (date.role === "active" ||
          (date.end_earliest === null && date.end_latest === null)),
      `date range ${date.id}`,
    );
    const subjectType = nodes.get(date.node_id)!.type;
    check(
      (!["birth", "death"].includes(date.role) || subjectType === "person") &&
        (date.role !== "publication" || subjectType === "work") &&
        (date.role !== "founding" || subjectType === "concept") &&
        (date.role !== "active" ||
          ["person", "work", "concept"].includes(subjectType)),
      `date subject ${date.id}`,
    );
    validateEvidence(date.evidence, date.id);
  }

  const withdrawals = Object.fromEntries(
    Object.entries(release.withdrawn).map(([key, values]) => [
      key,
      new Set(values),
    ]),
  ) as Record<keyof ProvisionalReleaseInput["withdrawn"], Set<string>>;
  function withdrawn(
    category: keyof typeof withdrawals,
    kind: string,
    key: string,
  ) {
    const entries = withdrawals[category];
    return (
      entries.has(key) ||
      entries.has(objectId(kind, key)) ||
      entries.has(revisionId(kind, key))
    );
  }
  const activeSources = new Set(
    [...sources.keys()].filter((id) => !withdrawn("sources", "source", id)),
  );
  const availableEvidence = (items: EvidenceInput[] | undefined) =>
    (items ?? []).every((item) => activeSources.has(item.source));
  const activeClaims = new Set(
    [...claims.values()]
      .filter(
        (claim) =>
          !withdrawn("assertions", "assertion", claim.id) &&
          !withdrawn("nodes", "node", claim.subject) &&
          availableEvidence(claim.evidence),
      )
      .map((claim) => claim.id),
  );
  const activeNodes = new Set(
    [...nodes.keys()].filter((id) => !withdrawn("nodes", "node", id)),
  );
  const ownedClaims = new Map<string, string[]>();
  for (const claim of claims.values())
    ownedClaims.set(claim.subject, [
      ...(ownedClaims.get(claim.subject) ?? []),
      claim.id,
    ]);
  const availableBasis = (items: string[] | undefined) =>
    (items ?? []).every((id) => activeClaims.has(id));
  // Remove dependants until visibility stabilizes. A lost qualification hides its
  // dependent page instead of silently retaining a stronger unqualified claim.
  let changed: boolean;
  do {
    changed = false;
    for (const id of activeClaims) {
      const claim = claims.get(id)!;
      if (!activeNodes.has(claim.subject) || !availableBasis(claim.basis)) {
        activeClaims.delete(id);
        changed = true;
      }
    }
    for (const id of activeNodes) {
      const node = nodes.get(id)!;
      if (
        !availableEvidence(node.evidence) ||
        !availableBasis(node.basis) ||
        !(ownedClaims.get(id) ?? []).every((claim) => activeClaims.has(claim))
      ) {
        activeNodes.delete(id);
        changed = true;
      }
    }
  } while (changed);
  const activeRelations = [...relations.entries()].filter(
    ([key, relation]) =>
      !withdrawn("relationships", "relationship", key) &&
      !withdrawals.relationships.has(relationKey(relation)) &&
      activeNodes.has(relation.from) &&
      activeNodes.has(relation.to) &&
      availableBasis(relation.basis),
  );
  const activeDates = release.temporal_records.filter(
    (date) =>
      activeNodes.has(date.node_id) &&
      availableEvidence(date.evidence) &&
      !withdrawn("assertions", "temporal", date.id),
  );

  function sourceCards(items: EvidenceInput[]) {
    return items.map((item) => {
      const source = sources.get(item.source)!;
      return {
        source_revision_id: revisionId("source", source.id),
        citation: [source.title, source.author, source.host]
          .filter(Boolean)
          .join(" — "),
        locator: item.locator,
        role: item.role,
        edition: source.edition,
        url: source.url,
      };
    });
  }
  function basisSources(basis: string[] | undefined): EvidenceInput[] {
    const visited = new Set<string>();
    const result: EvidenceInput[] = [];
    function visit(id: string) {
      if (visited.has(id)) return;
      visited.add(id);
      const claim = claims.get(id)!;
      result.push(...claim.evidence);
      for (const next of claim.basis ?? []) visit(next);
    }
    for (const id of basis ?? []) visit(id);
    return result;
  }
  const proof = new Map<string, PublicEvidence>();
  function addProof(key: string, value: PublicEvidence) {
    proof.set(key, value);
    proof.set(value.id, value);
    proof.set(value.revision_id, value);
  }
  for (const id of activeClaims) {
    const claim = claims.get(id)!;
    addProof(id, {
      id: objectId("assertion", id),
      revision_id: revisionId("assertion", id),
      revision_no: 1,
      kind: "assertion",
      texts: [
        {
          role: "body",
          content: `${claim.text_ja}\n読み取る範囲：${claim.limit}`,
        },
      ],
      sources: sourceCards([...claim.evidence, ...basisSources(claim.basis)]),
      attributions: [
        {
          speaker: claim.attribution,
          role:
            claim.nature === "position" ? "original_statement" : "editor_note",
          context: claim.limit,
        },
      ],
      basis: (claim.basis ?? []).map((basis) => revisionId("assertion", basis)),
    });
  }
  for (const [key, relation] of activeRelations) {
    const value: PublicEvidence = {
      id: objectId("relationship", key),
      revision_id: revisionId("relationship", key),
      revision_no: 1,
      kind: "assertion",
      texts: [{ role: "body", content: relation.reason }],
      sources: sourceCards(basisSources(relation.basis)),
      attributions: [
        {
          speaker: "NOEMAPの編集上の関連付け",
          role: "editor_note",
          context:
            "探索のための構成。歴史的影響や概念の同一性を意味しない。人による確認は公開後に予定。",
        },
      ],
      basis: relation.basis.map((basis) => revisionId("assertion", basis)),
    };
    addProof(key, value);
    for (const [alias, target] of relationAliases)
      if (target === key) proof.set(alias, value);
  }

  const summaries = new Map<string, NodeSummary>();
  const nodeLookup = new Map<string, string>();
  for (const id of activeNodes) {
    const node = nodes.get(id)!;
    const summary: NodeSummary = {
      id: objectId("node", id),
      revision_id: revisionId("node", id),
      type: node.type as NodeType,
      title: node.label,
      aliases: [...(node.aliases ?? [])],
      href: `/${collections[node.type as NodeType]}/${id}`,
      summary: node.summary_ja,
    };
    summaries.set(id, summary);
    for (const key of [id, summary.id, summary.revision_id])
      nodeLookup.set(key, id);
  }
  const dates: TimelineRecord[] = activeDates
    .map((date) => {
      const record: TimelineRecord = {
        id: revisionId("temporal", date.id),
        node: summaries.get(date.node_id)!,
        role: date.role,
        date_label: date.date_label,
        original_label: date.original_label,
        calendar: date.calendar,
        normalization: date.normalization,
        precision: "year",
        start_earliest: date.start_earliest,
        start_latest: date.start_latest,
        end_earliest: date.end_earliest,
        end_latest: date.end_latest,
      };
      addProof(date.id, {
        id: objectId("temporal", date.id),
        revision_id: record.id,
        revision_no: 1,
        kind: "assertion",
        texts: [
          {
            role: "body",
            content: `${date.text_ja}\n読み取る範囲：${date.limit}`,
          },
        ],
        sources: sourceCards(date.evidence),
        basis: [],
        attributions: [
          {
            speaker: "NOEMAPによる出典付き年代整理",
            role: "editor_note",
            context: date.limit,
          },
        ],
      });
      return record;
    })
    .sort(
      (a, b) =>
        (a.start_earliest ?? a.end_earliest ?? Infinity) -
          (b.start_earliest ?? b.end_earliest ?? Infinity) ||
        a.id.localeCompare(b.id),
    );
  const documents = new Map<string, NodeDocument>();
  for (const id of activeNodes) {
    const node = nodes.get(id)!;
    const summary = summaries.get(id)!;
    const scope = [
      node.definition_scope
        ? `このページで扱う意味：${node.definition_scope}`
        : "",
      node.scope_limit ? `読み取る範囲：${node.scope_limit}` : "",
    ].filter(Boolean);
    const summaryKey = `${id}-summary`;
    const summaryProof: PublicEvidence = {
      id: objectId("summary", id),
      revision_id: revisionId("summary", id),
      revision_no: 1,
      kind: "assertion",
      texts: [
        { role: "body", content: [node.summary_ja, ...scope].join("\n") },
      ],
      sources: sourceCards([
        ...(node.evidence ?? []),
        ...basisSources(node.basis),
      ]),
      basis: (node.basis ?? []).map((basis) => revisionId("assertion", basis)),
      attributions: [
        {
          speaker:
            node.nature === "editorial"
              ? "NOEMAPの編集上の問い"
              : "NOEMAPによる資料要約",
          role: "editor_note",
          context:
            "資料に基づく日本語の要約・案内。人による内容確認は公開後に予定。",
        },
      ],
    };
    addProof(summaryKey, summaryProof);
    const sections: Article["sections"] = [
      {
        revision_id: revisionId("block-summary", id),
        text: ["概要", node.summary_ja, ...scope].join("\n"),
        assertions: [summaryProof],
      },
    ];
    for (const claimId of ownedClaims.get(id) ?? []) {
      const claim = claims.get(claimId)!;
      sections.push({
        revision_id: revisionId("block-claim", claimId),
        text: [
          claim.evidence.some((e) => e.role === "qualification")
            ? "補足と留保"
            : "資料から読む",
          claim.text_ja,
          `読み取る範囲：${claim.limit}`,
        ].join("\n"),
        assertions: [proof.get(claimId)!],
      });
    }
    documents.set(id, {
      ...summary,
      article: {
        entity: {
          id: summary.id,
          revision_id: summary.revision_id,
          revision_no: 1,
          kind: "entity",
          texts: [{ role: "preferred", content: summary.title }],
        },
        sections,
        connections: [],
      },
      dates: dates.filter((date) => date.node.id === summary.id),
    });
  }

  // Read projections share one immutable snapshot, including returned objects.
  const frozen = new WeakSet<object>();
  function freeze(value: unknown): void {
    if (value === null || typeof value !== "object" || frozen.has(value))
      return;
    frozen.add(value);
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  for (const value of summaries.values()) freeze(value);
  for (const value of documents.values()) freeze(value);
  for (const value of proof.values()) freeze(value);
  for (const value of dates) freeze(value);

  function page<T>(items: T[], offset: number) {
    return {
      items: items.slice(offset, offset + 20),
      offset,
      has_more: items.length > offset + 20,
    };
  }
  function publicNode(id: string): NodeDocument | null {
    const key = nodeLookup.get(id);
    return key ? documents.get(key)! : null;
  }
  function neighbors(id: string, offset = 0): NeighborPage {
    const key = nodeLookup.get(id);
    if (!key || !validOffset(offset))
      return { items: [], offset: 0, has_more: false };
    const items = activeRelations
      .filter(([, relation]) => relation.from === key || relation.to === key)
      .map(([relationId, relation]) => ({
        id: revisionId("relationship", relationId),
        direction:
          relation.from === key ? ("outgoing" as const) : ("incoming" as const),
        label: "編集上の関連",
        reason: relation.reason,
        node: summaries.get(
          relation.from === key ? relation.to : relation.from,
        )!,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    return page(items, offset);
  }
  function searchNodes(q: string, type?: string, offset = 0): NodePage {
    if (!validOffset(offset) || (type && !nodeTypes.has(type)))
      return { items: [], offset: 0, has_more: false };
    const query = normalized(q).trim().slice(0, 160);
    const ranked = [...summaries.values()]
      .filter((node) => !type || node.type === type)
      .map((node) => {
        const title = normalized(node.title);
        const aliases = node.aliases.map(normalized);
        const values = [title, ...aliases];
        const rank =
          !query || title === query
            ? 0
            : aliases.includes(query)
              ? 1
              : values.some((value) => value.startsWith(query))
                ? 2
                : values.some((value) => value.includes(query))
                  ? 3
                  : Infinity;
        return { node, rank };
      })
      .filter((item) => Number.isFinite(item.rank))
      .sort(
        (a, b) =>
          a.rank - b.rank ||
          a.node.title.localeCompare(b.node.title, "ja") ||
          a.node.id.localeCompare(b.node.id),
      );
    return page(
      ranked.map((item) => item.node),
      offset,
    );
  }
  return {
    // Keep UUID/alias tombstones while adding stable raw identities before a
    // save/restore assigns another release ID. Dependencies remain implicit.
    normalizedWithdrawals(): ProvisionalReleaseInput["withdrawn"] {
      const result = {
        sources: new Set(release.withdrawn.sources),
        nodes: new Set(release.withdrawn.nodes),
        assertions: new Set(release.withdrawn.assertions),
        relationships: new Set(release.withdrawn.relationships),
      };
      for (const id of sources.keys())
        if (withdrawn("sources", "source", id)) result.sources.add(id);
      for (const id of nodes.keys())
        if (withdrawn("nodes", "node", id)) result.nodes.add(id);
      for (const id of claims.keys())
        if (withdrawn("assertions", "assertion", id)) result.assertions.add(id);
      for (const date of release.temporal_records)
        if (withdrawn("assertions", "temporal", date.id))
          result.assertions.add(date.id);
      for (const [key, relation] of relations)
        if (
          withdrawn("relationships", "relationship", key) ||
          withdrawals.relationships.has(relationKey(relation))
        )
          result.relationships.add(key);
      return {
        sources: [...result.sources],
        nodes: [...result.nodes],
        assertions: [...result.assertions],
        relationships: [...result.relationships],
      };
    },
    // Raw IDs only; copies prevent callers from changing the captured snapshot.
    // Persistence uses this to omit hidden content before anonymous DB reads.
    visibility() {
      return {
        sources: [...activeSources],
        nodes: [...activeNodes],
        assertions: [...activeClaims],
        relationships: activeRelations.map(([key]) => key),
        temporals: activeDates.map((date) => date.id),
      };
    },
    resolveNode(collection: string, key: string) {
      const id = nodeLookup.get(key);
      const node = id ? summaries.get(id) : undefined;
      return node && collections[node.type] === collection
        ? { id: node.id, href: node.href, redirect: key !== id }
        : null;
    },
    publicNode,
    nodePage(id: string, offset = 0) {
      if (!validOffset(offset)) return null;
      const document = publicNode(id);
      return document ? { document, neighbors: neighbors(id, offset) } : null;
    },
    neighbors,
    searchNodes,
    explorationHome() {
      const questions = [...summaries.values()].filter(
        (node) => node.type === "question",
      );
      const root =
        questions.find((node) => node.title === "人間とは何か？") ??
        questions[0] ??
        null;
      return {
        root,
        questions,
        neighbors: root
          ? neighbors(root.id)
          : { items: [], offset: 0, has_more: false },
      };
    },
    timelineNodes(offset = 0): TimelinePage {
      return validOffset(offset)
        ? page(dates, offset)
        : { items: [], offset: 0, has_more: false };
    },
    evidence(id: string): PublicEvidence | null {
      return proof.get(id) ?? null;
    },
    catalog(): CatalogItem[] {
      return [...documents.values()].map((node) => ({
        id: node.id,
        revision_id: node.revision_id,
        title: node.title,
        sections: node.article.sections.length,
      }));
    },
    article(id: string): Article | null {
      return publicNode(id)?.article ?? null;
    },
  };
}
