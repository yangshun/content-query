import { createRootRoute, HeadContent, Outlet, Scripts, useRouter } from "@tanstack/react-router";
import { onContentUpdate } from "content-query:client";
import { useEffect } from "react";
import "../../../../shared/styles.css";

export const Route = createRootRoute({ component: RootDocument });

function RootDocument() {
  const router = useRouter();
  useEffect(() => onContentUpdate(() => router.invalidate()), [router]);
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
