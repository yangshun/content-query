"use client";

import { useState } from "react";
import "./widgets.css";

/** A counter whose initial markup and layout remain stable through hydration and interaction. */
export function Counter({ initialCount = 0 }: { initialCount?: number }) {
  const [count, setCount] = useState(initialCount);
  return (
    <section className="widget" aria-label="Counter demo">
      <button type="button" onClick={() => setCount((current) => current + 1)}>
        Increment
      </button>
      <output className="counter-value" aria-label="Count" aria-live="polite">
        {count}
      </output>
    </section>
  );
}
