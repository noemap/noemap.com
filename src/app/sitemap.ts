import type { MetadataRoute } from "next";
import { publicEntryData } from "../server/entry";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const data = await publicEntryData();
  const paths = [
    "/",
    "/questions",
    "/themes",
    "/explore",
    "/people",
    "/concepts",
    "/books",
    "/timeline",
    "/about",
    ...data.themes
      .filter((t) => t.groups.length)
      .map((t) => `/themes/${t.slug}`),
    ...data.nodes.map((n) => n.href),
  ];
  return [...new Set(paths)].map((path) => ({
    url: `https://noemap.com${path}`,
  }));
}
