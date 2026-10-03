import { validateEditableDocument } from "./editable.ts";
import type { ProvisionalReleaseInput } from "./provisional";

type Snapshot = { document: ProvisionalReleaseInput };
const pending = () => ({
  status: "pending",
  reviewer: null,
  approved_at: null,
});
const metadataFields = new Set([
  "title",
  "author",
  "language",
  "original_publication",
  "original_title_page_year",
  "identity_chapter_added_edition",
  "identity_chapter_added_year",
  "metadata_basis",
  "first_publication_year",
  "basis_locator",
  "original_work_ref",
  "original_edition_not_identical_to_accessed_file",
  "ebook_id",
  "displayed_title_year",
  "catalog_basis",
  "critical_edition_alignment",
  "numbering",
  "release_date",
  "last_update",
  "credits",
  "catalog_note",
  "editor_or_maintainer",
  "displayed_copytext",
  "transcription_origin",
  "alignment_status",
  "internal_storage",
  "quote_display",
  "full_text_publication",
  "work_id",
  "canonical_title",
  "title_ja",
  "original_publication",
  "volumes_1_and_2",
  "volume_3",
  "appendix",
  "year",
  "evidence",
  "publisher_place_and_imprint",
  "full_original_title_page_transcription",
  "online_edition",
  "host",
  "editors",
  "publication_or_revision_date",
  "display_used",
  "copytext",
  "editorial_notes_ja",
  "scope_limit",
  "summaries",
  "concept_identity",
  "relationships",
  "dates",
  "source",
  "locator",
  "role",
]);
function safe(value: unknown, restricted = false): unknown {
  if (typeof value === "string") {
    if (
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value) ||
      /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/.test(value) ||
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(value) ||
      /[?&](?:token|secret|signature|credential|access_token|refresh_token|api_key|apikey|authorization|password|email)=/i.test(
        value,
      )
    )
      throw new Error(
        "データに連絡先または認証情報の候補が含まれています。内容を確認してから保存してください。",
      );
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => safe(item, restricted));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !restricted || metadataFields.has(key))
        .map(([key, child]) => [key, safe(child, restricted)]),
    );
  return value;
}
function pick(
  value: object,
  fields: string[],
  restrictedChildren: string[] = [],
) {
  const input = value as Record<string, unknown>;
  return Object.fromEntries(
    fields
      .filter((field) => input[field] !== undefined)
      .map((field) => [
        field,
        safe(input[field], restrictedChildren.includes(field)),
      ]),
  );
}
function documentCopy(
  document: ProvisionalReleaseInput,
): ProvisionalReleaseInput {
  validateEditableDocument(document);
  const copy = {
    schema_version: 1,
    release_id: safe(document.release_id),
    publication_status: "provisional",
    human_review: pending(),
    authorized_by: "project-owner-request",
    batches: document.batches.map((batch) => ({
      ...pick(
        batch,
        ["batch_id", "purpose", "editorial_policy", "bibliographic_review"],
        ["editorial_policy", "bibliographic_review"],
      ),
      status: "draft",
      human_review: pending(),
      database_imported: false,
      published: false,
      node_candidates: batch.node_candidates.map((node) =>
        pick(
          node,
          [
            "id",
            "type",
            "label",
            "summary_ja",
            "aliases",
            "nature",
            "evidence",
            "basis",
            "definition_scope",
            "scope_limit",
          ],
          ["evidence"],
        ),
      ),
      assertion_candidates: batch.assertion_candidates.map((claim) => ({
        ...pick(
          claim,
          [
            "id",
            "subject",
            "nature",
            "attribution",
            "text_ja",
            "limit",
            "evidence",
            "basis",
          ],
          ["evidence"],
        ),
        kind: "claim",
      })),
      relationship_candidates: batch.relationship_candidates.map((relation) =>
        pick(relation, ["id", "from", "to", "nature", "reason", "basis"]),
      ),
      sources: batch.sources.map((source) => ({
        ...pick(
          source,
          [
            "id",
            "title",
            "author",
            "host",
            "url",
            "language",
            "accessed_date",
            "source_kind",
            "source_type",
            "edition",
            "original_work",
            "observed_online_edition",
            "examined_locations",
            "usage_permissions",
            "permission_basis",
            "permission_statement",
            "translator",
            "edition_notes_locator",
            "editorial_processing",
            "usage_notice",
            "original_language_collation",
            "editor",
            "editors",
            "quote_words_stored",
          ],
          [
            "original_work",
            "observed_online_edition",
            "usage_permissions",
            "examined_locations",
          ],
        ),
        stored_full_text: false,
      })),
    })),
    withdrawn: pick(document.withdrawn, [
      "sources",
      "nodes",
      "assertions",
      "relationships",
    ]),
    temporal_records: document.temporal_records.map((record) =>
      pick(
        record,
        [
          "id",
          "node_id",
          "role",
          "date_label",
          "original_label",
          "calendar",
          "normalization",
          "precision",
          "start_earliest",
          "start_latest",
          "end_earliest",
          "end_latest",
          "evidence",
          "text_ja",
          "limit",
        ],
        ["evidence"],
      ),
    ),
  };
  validateEditableDocument(copy);
  return copy;
}

// Preserve restoreable content, stable withdrawal tombstones and release IDs.
// Unknown private metadata, actor records, reasons and Auth state are omitted.
export function createDatasetBackup(state: {
  current: Snapshot;
  draft: Snapshot | null;
}) {
  return {
    schema_version: 1,
    kind: "noemap-backup",
    human_review: "pending",
    current: documentCopy(state.current.document),
    draft: state.draft ? documentCopy(state.draft.document) : null,
  };
}
