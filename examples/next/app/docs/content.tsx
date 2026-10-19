"use client";

import { useRouter } from "next/navigation";
import { navigateContentLink } from "../navigation";

export function GuideContent({ html }: { html: string }) {
  const router = useRouter();
  return (
    <div
      className="prose"
      onClick={(event) => navigateContentLink(event, (href) => router.push(href))}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
