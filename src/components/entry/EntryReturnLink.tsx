"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { readEntryReturn } from "./entry-navigation";
export function EntryReturnLink({ nodeId }: { nodeId: string }) {
  const [href, setHref] = useState("/questions");
  useEffect(() => {
    const saved = readEntryReturn(nodeId);
    if (saved) {
      const url = new URL(saved.path, window.location.origin);
      url.searchParams.set("return", "1");
      setHref(url.pathname + url.search);
    }
  }, [nodeId]);
  return (
    <Link href={href} prefetch={false} className="entry-return">
      {href === "/questions" ? "← 問いの一覧に戻る" : "← 問いの入口に戻る"}
    </Link>
  );
}
