import { useEffect } from "react";
import { useRouter } from "@void/react";
import { onContentUpdate } from "content-query:client";

/** Revalidates loader data after a content edit without navigating the document. */
export function ContentUpdates() {
  const router = useRouter();
  useEffect(
    () =>
      onContentUpdate(async () => {
        router.flushAll();
        await router.refresh({ replace: true, preserveState: true, preserveScroll: true });
      }),
    [router],
  );
  return null;
}
