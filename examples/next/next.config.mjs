import { withContentQuery } from "content-query/next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

export default withContentQuery((phase) => ({
  output: phase === PHASE_DEVELOPMENT_SERVER ? undefined : "export",
}));
