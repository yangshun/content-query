import { useState } from "react";
import { exampleAuthors, examplePosts } from "./feature-example-data";

const graphPosts = [examplePosts[0]!, examplePosts[2]!, examplePosts[1]!];
const associations = [
  "M106 28 C128 28 128 63 150 63",
  "M106 90 C128 90 128 63 150 63",
  "M106 151 C128 151 128 135 150 135",
];

/** Illustrates the source-to-application flow without depending on a running compiler. */
export function ContentFlowDiagram() {
  const [playing, setPlaying] = useState(true);
  return (
    <figure
      className="home-flow-diagram"
      data-playing={playing}
      aria-label="Markdown and data become posts and authors connected by relationships in ContentQuery, then flow into your application"
    >
      <div className="flow-stages">
        <div className="flow-stage">
          <div className="flow-visual" aria-hidden="true">
            <div className="flow-files">
              {[".md", ".json", ".yaml", ".toml"].map((format) => (
                <span key={format}>{format}</span>
              ))}
            </div>
          </div>
          <strong>Markdown + data</strong>
          <span>Your content</span>
        </div>
        <div className="flow-connection" aria-hidden="true" />
        <div className="flow-stage">
          <div className="flow-visual flow-visual-graph" aria-hidden="true">
            <div className="flow-graph-frame">
              <div className="flow-graph">
                <svg fill="none" viewBox="0 0 240 180" preserveAspectRatio="none">
                  {associations.map((path) => (
                    <g key={path}>
                      <path className="flow-association" d={path} />
                      <path className="flow-association-active" pathLength={100} d={path} />
                    </g>
                  ))}
                </svg>
                {graphPosts.map((post, index) => (
                  <div className="flow-node flow-post" data-position={index} key={post.id}>
                    <small>post</small>
                    <span>{post.title}</span>
                  </div>
                ))}
                {exampleAuthors.map((author, index) => (
                  <div className="flow-node flow-author" data-position={index} key={author.id}>
                    <small>author</small>
                    <span>{author.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <strong>ContentQuery</strong>
          <span>Validate · Prepare</span>
        </div>
        <div className="flow-connection flow-connection-output" aria-hidden="true" />
        <div className="flow-stage">
          <div className="flow-visual" aria-hidden="true">
            <div className="flow-window">
              <div className="flow-window-header">
                <i />
                <i />
                <i />
              </div>
              <div className="flow-window-body">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
          <strong>Your application</strong>
          <span>Query · Render</span>
        </div>
      </div>
      <figcaption>
        <button
          className="home-flow-animation-control"
          type="button"
          aria-pressed={!playing}
          onClick={() => setPlaying((current) => !current)}
        >
          {playing ? "Pause animation" : "Play animation"}
        </button>
      </figcaption>
    </figure>
  );
}
