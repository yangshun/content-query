import { Component, computed, effect, inject } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { map } from "rxjs";
import { DomSanitizer, Meta, Title } from "@angular/platform-browser";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { navigateContentLink } from "../../navigation";
import type { GuideArticle } from "../guides-api";

@Component({
  imports: [RouterLink],
  styles: ":host { display: contents; }",
  template: `
    <main class="guide-main" id="main-content" tabindex="-1">
      @if (article(); as article) {
        <article>
          <header class="article-header">
            <h1>{{ article.guide.title }}</h1>
            <p>{{ article.guide.description }}</p>
          </header>
          <div class="prose" [innerHTML]="html()" (click)="navigate($event)"></div>
        </article>
        <nav class="page-navigation" aria-label="Previous and next guides">
          <div>
            @if (article.previous; as previous) {
              <a rel="prev" [routerLink]="'/docs/' + previous.id"
                ><span>← Previous</span>{{ previous.title }}</a
              >
            }
          </div>
          <div class="next-page">
            @if (article.next; as next) {
              <a rel="next" [routerLink]="'/docs/' + next.id"
                ><span>Next →</span>{{ next.title }}</a
              >
            }
          </div>
        </nav>
      } @else {
        <h1>Guide not found.</h1>
        <p>This guide is unavailable. <a routerLink="/">Back to the guides</a></p>
      }
    </main>
  `,
})
export class GuidePage {
  readonly article = toSignal(
    inject(ActivatedRoute).data.pipe(map((data) => data["article"] as GuideArticle)),
    { requireSync: true },
  );
  private readonly sanitizer = inject(DomSanitizer);
  private readonly router = inject(Router);
  // Repository-authored Markdown is trusted, including Shiki's inline token styles.
  readonly html = computed(() =>
    this.sanitizer.bypassSecurityTrustHtml(this.article()?.guide.html ?? ""),
  );

  constructor() {
    const title = inject(Title);
    const meta = inject(Meta);
    effect(() => {
      const guide = this.article()?.guide;
      title.setTitle(`${guide?.title ?? "Guide not found"} | ContentQuery x Angular`);
      meta.updateTag({ name: "description", content: guide?.description ?? "" });
    });
  }

  navigate(event: MouseEvent): void {
    navigateContentLink(event, (href) => this.router.navigateByUrl(href));
  }
}
