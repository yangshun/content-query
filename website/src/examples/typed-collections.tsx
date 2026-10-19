import { useState } from "react";
import { collectionExampleCode } from "../feature-example-data";
import { Checkbox, CodeExample, ValidationFeedback } from "./shared";

export function TypedCollectionsExample() {
  const [invalid, setInvalid] = useState(false);
  return (
    <div className="feature-example" aria-label="Typed collections example">
      <div className="validation-toolbar">
        <Checkbox checked={invalid} onChange={setInvalid}>
          Use an invalid draft value
        </Checkbox>
      </div>
      <div className="validation-workbench">
        <CodeExample
          label="content/posts/hello-world.md"
          code={`---\ntitle: Hello, world\ndraft: ${invalid ? '"yes"' : "false"}\nauthorId: ada\n---`}
          language="markdown"
          highlight={["draft:"]}
          invalid={invalid}
        />
        <CodeExample label="Schema" code={collectionExampleCode} highlight={["draft:"]} />
        <ValidationFeedback
          label="Content validation result"
          valid={!invalid}
          title={invalid ? "Validation failed" : "Validation passed"}
          details={[
            { label: "File", value: "content/posts/hello-world.md" },
            ...(invalid
              ? [
                  { label: "Field", value: "draft" },
                  { label: "Expected", value: "boolean" },
                  { label: "Received", value: '"yes" (string)' },
                ]
              : []),
          ]}
        />
      </div>
    </div>
  );
}
