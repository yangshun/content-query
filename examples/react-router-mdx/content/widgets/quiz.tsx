"use client";

import { useState } from "react";
import "./widgets.css";

/** A quiz that becomes interactive when visible in islands mode. */
export function Quiz({
  question = "When does client:visible hydrate a widget?",
}: {
  question?: string;
}) {
  const [answer, setAnswer] = useState("");
  return (
    <section className="widget" aria-label="Knowledge check">
      <h3>{question}</h3>
      <button onClick={() => setAnswer("Correct: when the widget enters the viewport.")}>
        When it becomes visible
      </button>
      <button onClick={() => setAnswer("Try again: visibility triggers hydration.")}>
        As soon as the page loads
      </button>
      <p role="status">{answer || "Choose an answer."}</p>
    </section>
  );
}
