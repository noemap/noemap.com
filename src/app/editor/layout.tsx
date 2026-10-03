import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocalFictional } from "../../server/mode";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function EditorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isLocalFictional()) notFound();
  return children;
}
