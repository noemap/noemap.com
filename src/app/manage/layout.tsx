import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "NOEMAP — 編集",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export default function ManageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="manage-page">{children}</div>;
}
