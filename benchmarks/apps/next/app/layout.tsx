import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../../../shared/styles.css";

export const metadata: Metadata = { title: "Next.js + ContentQuery benchmark" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
