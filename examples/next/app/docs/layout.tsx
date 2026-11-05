import "server-only";
import type { ReactNode } from "react";
import { guides } from "#content-query/guides";
import { Sidebar } from "./sidebar";

export default async function DocsLayout({ children }: { children: ReactNode }) {
  const entries = await guides.findMany({
    columns: { id: true, title: true },
    orderBy: { order: "asc" },
  });
  return (
    <div className="docs-layout">
      <Sidebar guides={entries} />
      {children}
    </div>
  );
}
