import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/index.tsx"),
  route("docs", "routes/docs.tsx", [route("*", "routes/guide.tsx")]),
] satisfies RouteConfig;
