<script lang="ts">
  import { page } from "$app/state";
  let { data, children }: import("./$types").LayoutProps = $props();
</script>

<div class="docs-layout">
  <nav class="guide-nav" aria-label="Guide navigation">
    <p>Guides</p>
    <ul>
      {#each data.guides as guide (guide.id)}
        <li>
          <a
            href={`/docs/${guide.id}/`}
            aria-current={page.url.pathname.replace(/\/$/, "") === `/docs/${guide.id}` ? "page" : undefined}
          >
            {guide.title}
          </a>
        </li>
      {/each}
    </ul>
  </nav>
  {@render children()}
</div>
