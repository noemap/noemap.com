import type { Article } from "./types";

export type NodeType = "question" | "person" | "concept" | "work";
export type NodeCollection = "questions" | "people" | "concepts" | "books";
export interface NodeSummary {
  id: string;
  revision_id: string;
  type: NodeType;
  title: string;
  aliases: string[];
  href: string;
  summary: string;
}
export interface NodeDocument extends NodeSummary {
  article: Article;
  dates?: TimelineRecord[];
}
export interface Neighbor {
  id: string;
  direction: "incoming" | "outgoing";
  label: string;
  reason: string;
  node: NodeSummary;
}
export interface NeighborPage {
  items: Neighbor[];
  offset: number;
  has_more: boolean;
}
export interface NodePage {
  items: NodeSummary[];
  offset: number;
  has_more: boolean;
}
export interface TimelineRecord {
  id: string;
  node: NodeSummary;
  role: string;
  date_label: string;
  original_label: string;
  calendar: string;
  normalization: string;
  precision: "year";
  start_earliest: number | null;
  start_latest: number | null;
  end_earliest: number | null;
  end_latest: number | null;
}
export interface TimelinePage {
  items: TimelineRecord[];
  offset: number;
  has_more: boolean;
}
export const nodeTypeNames: Record<NodeType, string> = {
  question: "問い",
  person: "人物",
  concept: "概念",
  work: "著作",
};
export const nodeCollections: Record<NodeType, NodeCollection> = {
  question: "questions",
  person: "people",
  concept: "concepts",
  work: "books",
};
export const temporalRoleNames: Record<string, string> = {
  birth: "生年",
  death: "没年",
  active: "活動年代",
  publication: "刊行年",
  founding: "成立年代",
};
export type PageQuery = Record<string, string | string[] | undefined>;
export function queryText(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}
export function queryOffset(value: string | string[] | undefined): number {
  const text = queryText(value);
  return /^\d{1,5}$/.test(text) && Number(text) <= 10000 ? Number(text) : 0;
}
export function queryNodeType(
  value: string | string[] | undefined,
): NodeType | undefined {
  const text = queryText(value);
  return text === "question" ||
    text === "person" ||
    text === "concept" ||
    text === "work"
    ? text
    : undefined;
}
