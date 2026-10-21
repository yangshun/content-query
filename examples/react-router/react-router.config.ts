import type { Config } from "@react-router/dev/config";
import { buildContent } from "content-query/build";
import type { collections } from "./content-query.config";

export default {
  ssr: false,
  async prerender() {
    const session = await buildContent<typeof collections>({ backend: "in-memory" });
    try {
      const guides = await session.content.query.guides.findMany({ columns: { id: true } });
      return ["/", ...guides.map(({ id }) => `/docs/${id}/`)];
    } finally {
      await session.dispose();
    }
  },
} satisfies Config;
