import type { ReactNode } from "react";
import { examplePosts } from "../feature-example-data";
import { HighlightedCode, type CodeLanguage } from "../highlighted-code";

export function CodeExample({
  label,
  code,
  language = "typescript",
  highlight = [],
  invalid = false,
}: {
  label: string;
  code: string;
  language?: CodeLanguage;
  highlight?: readonly string[];
  invalid?: boolean;
}) {
  return (
    <figure className="example-code">
      <figcaption>{label}</figcaption>
      <pre tabIndex={0} aria-label={label}>
        <HighlightedCode code={code} language={language} highlight={highlight} invalid={invalid} />
      </pre>
    </figure>
  );
}

export function Choices<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Value;
  options: readonly { value: Value; label: string }[];
  onChange: (value: Value) => void;
}) {
  return (
    <div className="example-choices" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          aria-pressed={option.value === value}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="example-checkbox">
      <input
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        type="checkbox"
      />
      <span>{children}</span>
    </label>
  );
}

export function SamplePosts({
  mutedTitles,
  label = "Query sample posts",
}: {
  mutedTitles: readonly string[];
  label?: string;
}) {
  return (
    <div className="example-table-scroll">
      <table className="example-table" aria-label={label}>
        <thead>
          <tr>
            <th scope="col">title</th>
            <th scope="col">draft</th>
          </tr>
        </thead>
        <tbody>
          {examplePosts.map((post) => (
            <tr key={post.id} data-muted={mutedTitles.includes(post.title)}>
              <td>{post.title}</td>
              <td>{String(post.draft)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CodeResult({
  label,
  code,
  language,
}: {
  label: string;
  code: string;
  language: CodeLanguage;
}) {
  return (
    <pre className="example-code-result" aria-label={label} tabIndex={0} key={code}>
      <HighlightedCode code={code} language={language} />
    </pre>
  );
}

export function DataResult({ label, value }: { label: string; value: unknown }) {
  return (
    <CodeResult label={label} code={JSON.stringify(value, null, 2) ?? "null"} language="json" />
  );
}

export function ValidationFeedback({
  label,
  valid,
  title,
  details,
}: {
  label: string;
  valid: boolean;
  title: string;
  details: readonly { label: string; value: string }[];
}) {
  return (
    <div className="example-validation" data-valid={valid} role="status" aria-label={label}>
      <strong>
        <span aria-hidden="true">{valid ? "✓" : "!"}</span> {title}
      </strong>
      <dl>
        {details.map((detail) => (
          <div key={detail.label}>
            <dt>{detail.label}</dt>
            <dd>
              <code>{detail.value}</code>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
