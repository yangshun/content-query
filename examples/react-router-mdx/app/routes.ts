import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/index.tsx"),
  route(":mode/docs/:slug", "routes/guide.tsx"),
] satisfies RouteConfig;
