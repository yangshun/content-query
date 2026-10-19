import type { Config } from "@react-router/dev/config";
import { prepareContent } from "content-query/build";
import type { collections } from "./content-query.config";

export default {
  ssr: false,
  async prerender() {
    const session = await prepareContent<typeof collections>({ backend: "in-memory" });
    try {
      const guides = await session.content.findMany("guides", { select: { id: true } });
      return ["/", ...guides.map(({ id }) => `/docs/${id}/`)];
    } finally {
      await session.dispose();
    }
  },
} satisfies Config;
