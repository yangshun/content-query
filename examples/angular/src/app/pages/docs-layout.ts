import { Component, inject } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { map } from "rxjs";
import { ActivatedRoute, RouterLink, RouterLinkActive, RouterOutlet } from "@angular/router";
import type { NavigationGuides } from "../guides-api";

@Component({
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  styles: "router-outlet { display: none; }",
  template: `
    <div class="docs-layout">
      <nav class="guide-nav" aria-label="Guide navigation">
        <p>Guides</p>
        <ul>
          @for (guide of guides(); track guide.id) {
            <li>
              <a
                [routerLink]="'/docs/' + guide.id"
                routerLinkActive="active"
                [routerLinkActiveOptions]="{ exact: true }"
                ariaCurrentWhenActive="page"
                >{{ guide.title }}</a
              >
            </li>
          }
        </ul>
      </nav>
      <router-outlet />
    </div>
  `,
})
export class DocsLayout {
  readonly guides = toSignal(
    inject(ActivatedRoute).data.pipe(map((data) => data["guides"] as NavigationGuides)),
    { requireSync: true },
  );
}
