import { hydrateRoot } from "react-dom/client";
import { App } from "./app";
import "../../../shared/styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing application root.");
}
hydrateRoot(root, <App pathname={window.location.pathname} />);
