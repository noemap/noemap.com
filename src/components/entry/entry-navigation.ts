const key = "noemap-entry-return-v1";
interface EntryReturn {
  version: 1;
  nodeId: string;
  path: string;
  scroll: number;
  at: number;
}
export function rememberEntry(nodeId: string) {
  try {
    sessionStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        nodeId,
        path: window.location.pathname + window.location.search,
        scroll: window.scrollY,
        at: Date.now(),
      } satisfies EntryReturn),
    );
  } catch {
    /* The URL and native browser history still work. */
  }
}
export function readEntryReturn(nodeId?: string): EntryReturn | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw || raw.length > 2000) return null;
    const v = JSON.parse(raw) as EntryReturn;
    if (
      v.version !== 1 ||
      typeof v.path !== "string" ||
      typeof v.nodeId !== "string" ||
      (nodeId && v.nodeId !== nodeId) ||
      !Number.isFinite(v.scroll) ||
      v.scroll < 0 ||
      v.scroll > 100000 ||
      !Number.isFinite(v.at) ||
      Date.now() - v.at > 30 * 60 * 1000
    )
      return null;
    const url = new URL(v.path, window.location.origin);
    if (
      url.origin !== window.location.origin ||
      !/^\/$|^\/themes\/[a-z]+(?:-[a-z]+)*$/.test(url.pathname)
    )
      return null;
    return v;
  } catch {
    return null;
  }
}
