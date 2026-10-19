import { inject, RESPONSE_INIT } from "@angular/core";
import type { ActivatedRouteSnapshot, Routes } from "@angular/router";
import { tap } from "rxjs";
import { GuidesApi } from "./guides-api";

export const routes: Routes = [
  {
    path: "",
    pathMatch: "full",
    loadComponent: () => import("./pages/home").then((page) => page.HomePage),
    resolve: { guides: () => inject(GuidesApi).home() },
  },
  {
    path: "docs",
    loadComponent: () => import("./pages/docs-layout").then((page) => page.DocsLayout),
    resolve: { guides: () => inject(GuidesApi).navigation() },
    children: [
      {
        path: "**",
        loadComponent: () => import("./pages/guide").then((page) => page.GuidePage),
        resolve: {
          article: (route: ActivatedRouteSnapshot) => {
            const response = inject(RESPONSE_INIT);
            const id = route.url.map((segment) => segment.path).join("/");
            return inject(GuidesApi)
              .guide(id)
              .pipe(
                tap((article) => {
                  if (!article && response) {
                    response.status = 404;
                  }
                }),
              );
          },
        },
      },
    ],
  },
  { path: "**", redirectTo: "" },
];
