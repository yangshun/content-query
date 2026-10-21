import "server-only";
import type { ReactNode } from "react";
import { content } from "#content-query";
import { Sidebar } from "./sidebar";

export default async function DocsLayout({ children }: { children: ReactNode }) {
  const guides = await content.query.guides.findMany({
    columns: { id: true, title: true },
    orderBy: { order: "asc" },
  });
  return (
    <div className="docs-layout">
      <Sidebar guides={guides} />
      {children}
    </div>
  );
}
