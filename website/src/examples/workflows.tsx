import { useEffect, useState } from "react";
import { Choices, CodeExample } from "./shared";

const developmentSteps = [
  "Ready to edit",
  "Edit the title",
  "Save the file",
  "Page data refreshed",
];

export const nextWorkflowExample = {
  config:
    'import { withContentQuery } from "content-query/next";\n\nexport default withContentQuery({\n  trailingSlash: true,\n});',
  packageJson: '{\n  "imports": {\n    "#content-query": "./.content-query/server.js"\n  }\n}',
  query:
    'import "server-only";\nimport { content } from "#content-query";\n\nconst posts = await content.select("id", "title").from("posts")\n  .all();',
};

export function NextWorkflow() {
  return (
    <div className="standalone-workflow">
      <div className="workflow-setup">
        <CodeExample label="next.config.mjs" code={nextWorkflowExample.config} />
        <CodeExample label="package.json" code={nextWorkflowExample.packageJson} language="json" />
      </div>
      <CodeExample label="Query from server code" code={nextWorkflowExample.query} />
    </div>
  );
}

function AngularWorkflow() {
  return (
    <div className="standalone-workflow">
      <div className="workflow-setup">
        <CodeExample
          label="Build with Angular CLI"
          code="npx content-query build && ng build"
          language="shellscript"
        />
        <CodeExample
          label="Develop in two terminals"
          code={"# Terminal 1\nnpx content-query build --watch\n\n# Terminal 2\nng serve"}
          language="shellscript"
        />
      </div>
      <CodeExample
        label="src/server.ts (Angular SSR)"
        code={
          'import { content } from "../.content-query/server.js";\n\napp.get("/api/posts", async (_request, response) => {\n  const posts = await content.select("id", "title").from("posts")\n    .all();\n\n  response.json(posts);\n});'
        }
      />
    </div>
  );
}

function DevelopmentAnimation() {
  const [playback, setPlayback] = useState({ step: 0, playing: false });
  useEffect(() => {
    if (!playback.playing) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setPlayback((current) => ({
        step: current.step + 1,
        playing: current.step + 1 < developmentSteps.length - 1,
      }));
    }, 1400);
    return () => window.clearTimeout(timeout);
  }, [playback.playing, playback.step]);
  const lastStep = playback.step === developmentSteps.length - 1;
  return (
    <>
      <div className="workflow-timeline">
        <ol className="example-steps" aria-label="Development steps">
          {developmentSteps.map((step, index) => (
            <li
              key={step}
              aria-current={index === playback.step ? "step" : undefined}
              data-complete={index < playback.step}
            >
              {step}
            </li>
          ))}
        </ol>
        <div className="example-animation-controls">
          <button
            type="button"
            onClick={() =>
              setPlayback((current) => ({
                step: lastStep ? 0 : current.step,
                playing: !current.playing,
              }))
            }
          >
            {playback.playing ? "Pause" : lastStep ? "Replay" : "Play demo"}
          </button>
          <button
            type="button"
            disabled={lastStep}
            onClick={() => setPlayback((current) => ({ step: current.step + 1, playing: false }))}
          >
            Next step
          </button>
        </div>
      </div>
      <div className="workflow-preview-grid">
        <CodeExample
          label="content/posts/hello-world.md"
          code={`---\ntitle: ${playback.step > 0 ? "Hello, ContentQuery" : "Hello, world"}\ndraft: false\nauthorId: ada\n---`}
          language="markdown"
          highlight={playback.step > 0 ? ["title:"] : []}
        />
        <span className="workflow-arrow" aria-hidden="true">
          →
        </span>
        <div
          className="example-app-preview"
          data-updated={lastStep}
          role="status"
          aria-label="Application preview"
          aria-busy={playback.step === 2}
        >
          <strong>{lastStep ? "Hello, ContentQuery" : "Hello, world"}</strong>
          <p>Content starts here.</p>
        </div>
      </div>
    </>
  );
}

export function WorkflowsExample() {
  const [workflow, setWorkflow] = useState<"vite" | "next" | "angular" | "standalone">("vite");
  return (
    <div
      className="feature-example"
      aria-label="Vite, Next.js, Angular, and standalone workflows example"
    >
      <div className="workflow-switch">
        <Choices
          label="Content workflow"
          value={workflow}
          onChange={setWorkflow}
          options={[
            { value: "vite", label: "Vite development" },
            { value: "next", label: "Next.js development" },
            { value: "angular", label: "Angular development" },
            { value: "standalone", label: "Standalone build" },
          ]}
        />
      </div>
      {workflow === "vite" ? (
        <DevelopmentAnimation />
      ) : workflow === "next" ? (
        <NextWorkflow />
      ) : workflow === "angular" ? (
        <AngularWorkflow />
      ) : (
        <div className="standalone-workflow">
          <CodeExample
            label="Build your content"
            code={"$ npx content-query build\n\n.content-query/\n  server.js\n  types.d.ts\n  …"}
            language="shellscript"
          />
          <CodeExample
            label="Import the generated runtime"
            code={
              'import { content } from "./.content-query/server.js";\n\nconst posts = await content.select("title").from("posts")\n  .all();'
            }
          />
        </div>
      )}
    </div>
  );
}
