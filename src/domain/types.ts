export type Role = "editor" | "reviewer" | "publisher";
export type Kind = "entity" | "source" | "assertion" | "block";
export interface TextRecord {
  id: string;
  revision_id: string;
  language: string;
  role: string;
  content: string;
}
export interface Revision {
  id: string;
  object_id: string;
  kind: Kind;
  variant: string;
  revision_no: number;
  state: "draft" | "frozen";
  reason: string;
}
export interface Listing extends Revision {
  title: string | null;
  object_state: "active" | "suspended";
  generation: number;
  published: boolean;
}
export interface Review {
  id: string;
  revision_id: string;
  reviewer: string;
  decision: string;
  reason: string;
  created_at: string;
  withdrawn_at: string | null;
  used: boolean;
  languages: string[];
}
export interface Evidence {
  id: string;
  revision_id: string;
  source_revision_id: string;
  locator: string;
  summary: string;
  role: string;
}
export interface Attribution {
  speaker_label: string;
  speaker_role: string;
  context: string;
  reporting_source_revision_id: string;
}
export interface EditorialTemporal {
  role: "birth" | "death" | "active" | "publication" | "founding";
  original_label: string;
  date_label: string;
  calendar: string;
  normalization: "astronomical_year";
  precision: "year";
  start_earliest: number | null;
  start_latest: number | null;
  end_earliest: number | null;
  end_latest: number | null;
}
export interface RevisionDetail {
  revision: Revision;
  generation: number;
  object_state: string;
  texts: TextRecord[];
  entity: { identity_scope: string } | null;
  source: { citation: string; source_language: string } | null;
  source_metadata: {
    edition: string;
    publication_info: string;
    url: string | null;
    work_revision_id: string | null;
  } | null;
  source_credits: { role: string; label: string }[];
  assertion: {
    subject_revision_id: string;
    target_revision_id: string | null;
    nature: string;
    rationale: string;
  } | null;
  temporal?: EditorialTemporal | null;
  block: {
    entity_revision_id: string;
    entity_id: string;
    language: string;
  } | null;
  evidence: Evidence[];
  attributions: Attribution[];
  basis: { assertion_revision_id: string; reason: string }[];
  translations: { text_id: string; source_text_id: string; reason: string }[];
  references: {
    assertion_revision_id: string;
    start_cp: number;
    end_cp: number;
  }[];
  reviews: Review[];
}
export interface PublicRevision {
  id: string;
  revision_id: string;
  revision_no: number;
  kind: Kind;
  texts: { role: string; content: string }[];
}
export interface PublicEvidence extends PublicRevision {
  sources: {
    source_revision_id: string;
    citation: string;
    locator: string;
    role: string;
    edition: string | null;
    url: string | null;
  }[];
  attributions: { speaker: string; role: string; context: string }[];
  basis: string[];
}
export interface Connection {
  revision_id: string;
  subject: string;
  subject_revision_id: string;
  target_revision_id: string;
  label: string;
}
export interface Article {
  entity: PublicRevision;
  sections: {
    revision_id: string;
    text: string;
    assertions: PublicEvidence[];
  }[];
  connections: Connection[];
}
export interface CatalogItem {
  id: string;
  revision_id: string;
  title: string;
  sections: number;
}
export const kindNames: Record<Kind, string> = {
  entity: "問い・知識項目",
  source: "資料",
  assertion: "記述",
  block: "記事の本文",
};
export const variantNames: Record<string, string> = {
  question: "問い",
  person: "人物",
  work: "著作",
  concept: "概念",
  edition: "資料の版",
  claim: "主張・説明",
  relationship: "関係",
  summary: "説明",
  comparison: "比較",
};
export const roleNames: Record<string, string> = {
  original_statement: "本人の説明",
  quoted_person: "引用された人",
  reported_position: "他説の紹介",
  editor_note: "編者の注記",
  hypothesis: "仮定",
};
