import { createProvisionalRelease } from "./provisional.ts";
import type { ProvisionalReleaseInput } from "./provisional";

type Batch = ProvisionalReleaseInput["batches"][number];
type Evidence = NonNullable<
  Batch["node_candidates"][number]["evidence"]
>[number];
type Source = Batch["sources"][number];
type PublicSource = Source & {
  language?: string;
  accessed_date?: string;
  translator?: string;
  editor?: string;
  editors?: string[];
  usage_notice?: string;
};

const evidence = (items: Evidence[]) =>
  items.map((item) => ({
    source: item.source,
    locator: item.locator,
    role: item.role,
  }));

function sourceMetadata(source: Source): PublicSource {
  const result: PublicSource = {
    id: source.id,
    title: source.title,
    edition: source.edition,
    url: source.url,
  };
  // These are bibliographic/public display fields, not an open-ended spread.
  // Original documents, credentials, reviewer notes and import metadata stay in
  // the private snapshot even when a caller adds unknown nested properties.
  const fields = source as unknown as Record<string, unknown>;
  for (const key of [
    "author",
    "host",
    "language",
    "accessed_date",
    "translator",
    "editor",
    "usage_notice",
  ] as const) {
    const value = fields[key];
    if (typeof value === "string") result[key] = value;
  }
  if (
    Array.isArray(fields.editors) &&
    fields.editors.every((item) => typeof item === "string")
  )
    result.editors = [...fields.editors];
  return result;
}

function validatePublicFieldTypes(raw: ProvisionalReleaseInput) {
  const string = (value: unknown, field: string) => {
    if (typeof value !== "string")
      throw new Error(`Invalid public projection field: ${field}`);
  };
  const optionalString = (value: unknown, field: string) => {
    if (value !== undefined) string(value, field);
  };
  for (const batch of raw.batches) {
    string(batch.batch_id, "batch_id");
    for (const node of batch.node_candidates) {
      for (const field of [
        "nature",
        "definition_scope",
        "scope_limit",
      ] as const)
        optionalString(node[field], `${node.id}.${field}`);
      if (node.aliases !== undefined) {
        if (!Array.isArray(node.aliases))
          throw new Error(
            `Invalid public projection field: ${node.id}.aliases`,
          );
        for (const alias of node.aliases) string(alias, `${node.id}.aliases`);
      }
    }
    for (const source of batch.sources) {
      optionalString(source.author, `${source.id}.author`);
      optionalString(source.host, `${source.id}.host`);
    }
    for (const claim of batch.assertion_candidates)
      string(claim.nature, `${claim.id}.nature`);
    for (const relation of batch.relationship_candidates)
      optionalString(relation.id, "relation.id");
  }
}

/**
 * Build the only JSON document suitable for anonymous storage/read access.
 * The adapter determines visibility to its existing dependency fixed point.
 * Every retained record is reconstructed from a field allowlist; no raw object
 * or private metadata is spread into the result. Withdrawal lists are emptied
 * after hidden records are removed, so the original withdrawn text/IDs cannot
 * be downloaded from the public document. The immutable raw snapshot remains
 * necessary for private edit/restore operations and monotonic withdrawals.
 */
export function projectPublicDocument(
  input: ProvisionalReleaseInput,
): ProvisionalReleaseInput {
  const raw = structuredClone(input);
  validatePublicFieldTypes(raw);
  const visible = createProvisionalRelease(raw).visibility();
  const sources = new Set(visible.sources);
  const nodes = new Set(visible.nodes);
  const assertions = new Set(visible.assertions);
  const relationships = new Set(visible.relationships);
  const temporals = new Set(visible.temporals);
  return {
    schema_version: 1,
    release_id: raw.release_id,
    publication_status: "provisional",
    human_review: { status: "pending", reviewer: null, approved_at: null },
    authorized_by: "project-owner-request",
    batches: raw.batches.map((batch) => ({
      batch_id: batch.batch_id,
      node_candidates: batch.node_candidates
        .filter((node) => nodes.has(node.id))
        .map((node) => ({
          id: node.id,
          type: node.type,
          label: node.label,
          summary_ja: node.summary_ja,
          ...(node.aliases !== undefined ? { aliases: [...node.aliases] } : {}),
          ...(node.nature !== undefined ? { nature: node.nature } : {}),
          ...(node.evidence !== undefined
            ? { evidence: evidence(node.evidence) }
            : {}),
          ...(node.basis !== undefined ? { basis: [...node.basis] } : {}),
          ...(node.definition_scope !== undefined
            ? { definition_scope: node.definition_scope }
            : {}),
          ...(node.scope_limit !== undefined
            ? { scope_limit: node.scope_limit }
            : {}),
        })),
      sources: batch.sources
        .filter((source) => sources.has(source.id))
        .map(sourceMetadata),
      assertion_candidates: batch.assertion_candidates
        .filter((claim) => assertions.has(claim.id))
        .map((claim) => ({
          id: claim.id,
          subject: claim.subject,
          nature: claim.nature,
          attribution: claim.attribution,
          text_ja: claim.text_ja,
          limit: claim.limit,
          evidence: evidence(claim.evidence),
          ...(claim.basis !== undefined ? { basis: [...claim.basis] } : {}),
        })),
      relationship_candidates: batch.relationship_candidates.flatMap(
        (relation, index) => {
          const id = relation.id ?? `${batch.batch_id}:relation:${index}`;
          if (!relationships.has(id)) return [];
          // Explicitly preserve the original implicit ID: filtering the array must
          // not renumber later relationships and change UUID/evidence routes.
          return [
            {
              id,
              from: relation.from,
              to: relation.to,
              nature: relation.nature,
              reason: relation.reason,
              basis: [...relation.basis],
            },
          ];
        },
      ),
    })),
    withdrawn: { sources: [], nodes: [], assertions: [], relationships: [] },
    temporal_records: raw.temporal_records
      .filter((date) => temporals.has(date.id))
      .map((date) => ({
        id: date.id,
        node_id: date.node_id,
        role: date.role,
        date_label: date.date_label,
        original_label: date.original_label,
        calendar: date.calendar,
        normalization: date.normalization,
        precision: date.precision,
        start_earliest: date.start_earliest,
        start_latest: date.start_latest,
        end_earliest: date.end_earliest,
        end_latest: date.end_latest,
        evidence: evidence(date.evidence),
        text_ja: date.text_ja,
        limit: date.limit,
      })),
  };
}
