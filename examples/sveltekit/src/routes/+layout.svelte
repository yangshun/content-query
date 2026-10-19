<script lang="ts">
  import { onMount } from "svelte";
  import { refreshAll } from "$app/navigation";
  import { onContentUpdate } from "content-query:client";
  import "../app.css";
  let { children }: import("./$types").LayoutProps = $props();
  onMount(() => onContentUpdate(() => refreshAll()));
</script>

<div class="site-shell">
  <a class="skip-link" href="#main-content">Skip to content</a>
  <header class="site-header">
    <a class="wordmark" href="/">ContentQuery x SvelteKit</a>
    <a class="header-link" href="/">Documentation</a>
  </header>
  {@render children()}
  <footer class="site-footer">
    <span>ContentQuery x SvelteKit</span>
    <span>Documentation example.</span>
  </footer>
</div>
