"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { rememberEntry } from "./entry-navigation";

export function EntranceArticleLink({
  nodeId,
  href,
  className,
  children,
}: {
  nodeId: string;
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      className={className}
      onClick={() => rememberEntry(nodeId)}
    >
      {children}
    </Link>
  );
}
