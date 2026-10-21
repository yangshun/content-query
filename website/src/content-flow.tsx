import { useState } from "react";
import { exampleAuthors, examplePosts } from "./feature-example-data";

const graphPosts = [examplePosts[0]!, examplePosts[2]!, examplePosts[1]!];
const associations = [
  "M40 0 C40 30 60 30 60 60",
  "M120 0 C120 30 60 30 60 60",
  "M200 0 C200 30 180 30 180 60",
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
                <div className="flow-posts">
                  {graphPosts.map((post) => (
                    <div className="flow-node" key={post.id}>
                      <small>post</small>
                      <span>{post.title}</span>
                    </div>
                  ))}
                </div>
                <svg fill="none" viewBox="0 0 240 60" preserveAspectRatio="none">
                  {associations.map((path) => (
                    <g key={path}>
                      <path className="flow-association" d={path} />
                      <path className="flow-association-active" pathLength={100} d={path} />
                    </g>
                  ))}
                </svg>
                <div className="flow-authors">
                  {exampleAuthors.map((author) => (
                    <div className="flow-node" key={author.id}>
                      <small>author</small>
                      <span>{author.name}</span>
                    </div>
                  ))}
                </div>
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
