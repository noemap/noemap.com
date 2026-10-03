"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { readEntryReturn } from "./entry-navigation";
export function EntryReturnLink({
  nodeId,
  fallbackHref = "/questions",
  fallbackLabel = "問い",
}: {
  nodeId: string;
  fallbackHref?: string;
  fallbackLabel?: string;
}) {
  const [href, setHref] = useState(fallbackHref);
  useEffect(() => {
    setHref(fallbackHref);
    const saved = readEntryReturn(nodeId);
    if (saved) {
      const url = new URL(saved.path, window.location.origin);
      url.searchParams.set("return", "1");
      setHref(url.pathname + url.search);
    }
  }, [nodeId, fallbackHref]);
  return (
    <Link href={href} prefetch={false} className="entry-return">
      {href === fallbackHref
        ? `← ${fallbackLabel}の一覧に戻る`
        : "← 問いの入口に戻る"}
    </Link>
  );
}
