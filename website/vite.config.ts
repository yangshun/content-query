import { voidReact } from "@void/react/plugin";
import { contentQuery } from "content-query/vite";
import { defineConfig } from "vite-plus";
import { voidPlugin } from "void";

export default defineConfig({
  plugins: [voidPlugin(), voidReact({ viewTransitions: true }), contentQuery()],
});
