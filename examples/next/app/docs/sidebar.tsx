"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ContentGuide } from "#content-query/guides";

type Guide = ContentGuide<"id" | "title">;

export function Sidebar({ guides }: { guides: readonly Guide[] }) {
  const pathname = usePathname();
  return (
    <nav className="guide-nav" aria-label="Guide navigation">
      <p>Guides</p>
      <ul>
        {guides.map((guide) => (
          <li key={guide.id}>
            <Link
              href={`/docs/${guide.id}`}
              aria-current={pathname === `/docs/${guide.id}` ? "page" : undefined}
            >
              {guide.title}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
