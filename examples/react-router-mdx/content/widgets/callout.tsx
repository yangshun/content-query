import type { ReactNode } from "react";
import styles from "./callout.module.css";

/** A server-rendered component whose CSS must be available without its browser JavaScript. */
export function Callout({ children }: { children: ReactNode }) {
  return <aside className={styles.callout}>{children}</aside>;
}
