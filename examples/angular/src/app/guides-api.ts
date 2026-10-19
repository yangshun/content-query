import { DOCUMENT, Injectable, REQUEST, inject } from "@angular/core";
import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { catchError, of, throwError } from "rxjs";
import type { loadGuide, loadHome, loadNavigation } from "../server/content";

export type HomeGuides = Awaited<ReturnType<typeof loadHome>>;
export type NavigationGuides = Awaited<ReturnType<typeof loadNavigation>>;
export type GuideArticle = Awaited<ReturnType<typeof loadGuide>>;

@Injectable({ providedIn: "root" })
export class GuidesApi {
  private readonly http = inject(HttpClient);
  private readonly origin = inject(REQUEST)?.url ?? inject(DOCUMENT).baseURI;

  home() {
    return this.http.get<HomeGuides>(new URL("/api/guides", this.origin).href);
  }

  navigation() {
    return this.http.get<NavigationGuides>(new URL("/api/navigation", this.origin).href);
  }

  guide(id: string) {
    return this.http
      .get<GuideArticle>(new URL("/api/guide", this.origin).href, { params: { id } })
      .pipe(
        catchError((error: unknown) =>
          error instanceof HttpErrorResponse && error.status === 404
            ? of(null)
            : throwError(() => error),
        ),
      );
  }
}
