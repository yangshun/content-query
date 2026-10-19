import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants.js";

/**
 * Prepares a content snapshot before Next.js compiles its server components.
 * @param {string} phase The Next.js configuration phase.
 * @returns {Promise<import("next").NextConfig>} The static-export configuration.
 */
export default async function nextConfig(phase) {
  if (phase === PHASE_DEVELOPMENT_SERVER || phase === PHASE_PRODUCTION_BUILD) {
    const { prepareContent } = await import("content-query/build");
    const session = await prepareContent();
    await session.dispose();
  }

  return {
    output: "export",
    trailingSlash: true,
  };
}
