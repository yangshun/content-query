import { Component, inject } from "@angular/core";
import { Router, RouterLink, RouterOutlet } from "@angular/router";

@Component({
  selector: "app-root",
  imports: [RouterLink, RouterOutlet],
  template: `
    <div class="site-shell">
      <a class="skip-link" [href]="router.url.split('#')[0] + '#main-content'">Skip to content</a>
      <header class="site-header">
        <a class="wordmark" routerLink="/">ContentQuery x Angular</a>
        <a class="header-link" routerLink="/">Documentation</a>
      </header>
      <router-outlet />
      <footer class="site-footer">
        <span>ContentQuery x Angular</span>
        <span>Documentation example.</span>
      </footer>
    </div>
  `,
})
export class App {
  readonly router = inject(Router);
}
