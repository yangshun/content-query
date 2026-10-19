import { Component, inject } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { map } from "rxjs";
import { Title, Meta } from "@angular/platform-browser";
import { ActivatedRoute, RouterLink } from "@angular/router";
import type { HomeGuides } from "../guides-api";

@Component({
  imports: [RouterLink],
  template: `
    <main class="home" id="main-content" tabindex="-1">
      <div class="home-intro">
        <h1>Documentation</h1>
        <p>Sample guides for keeping project notes organized and working with your team.</p>
      </div>
      <section class="guide-index" aria-labelledby="guides-heading">
        <h2 id="guides-heading">Guides</h2>
        <ol class="guide-list">
          @for (guide of guides(); track guide.id; let index = $index) {
            <li>
              <a class="guide-row" [routerLink]="'/docs/' + guide.id">
                <span class="guide-number" aria-hidden="true">{{ (index + 1).toString().padStart(2, '0') }}</span>
                <div><h3>{{ guide.title }}</h3><p>{{ guide.description }}</p></div>
                <span class="guide-arrow" aria-hidden="true">→</span>
              </a>
            </li>
          }
        </ol>
      </section>
    </main>
  `,
})
export class HomePage {
  readonly guides = toSignal(
    inject(ActivatedRoute).data.pipe(map((data) => data["guides"] as HomeGuides)),
    { requireSync: true },
  );

  constructor() {
    inject(Title).setTitle("Documentation | ContentQuery x Angular");
    inject(Meta).updateTag({
      name: "description",
      content: "Sample guides for keeping project notes organized and working with your team.",
    });
  }
}
