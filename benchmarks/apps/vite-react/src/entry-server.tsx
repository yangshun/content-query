import { renderToString } from "react-dom/server";
import { App } from "./app";

export { prerenderPaths } from "./app";

export function render(pathname: string): string {
  return renderToString(<App pathname={pathname} />);
}
