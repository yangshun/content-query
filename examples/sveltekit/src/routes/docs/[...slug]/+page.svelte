<script lang="ts">
  let { data }: import("./$types").PageProps = $props();
</script>

<svelte:head>
  <title>{data.guide.title} | ContentQuery x SvelteKit</title>
  <meta name="description" content={data.guide.description} />
</svelte:head>

<main class="guide-main" id="main-content" tabindex="-1">
  <article>
    <header class="article-header">
      <h1>{data.guide.title}</h1>
      <p>{data.guide.description}</p>
    </header>
    <div class="prose">{@html data.guide.html}</div>
  </article>
  <nav class="page-navigation" aria-label="Previous and next guides">
    <div>
      {#if data.previous}
        <a rel="prev" href={`/docs/${data.previous.id}/`}>
          <span>← Previous</span>
          {data.previous.title}
        </a>
      {/if}
    </div>
    <div class="next-page">
      {#if data.next}
        <a rel="next" href={`/docs/${data.next.id}/`}>
          <span>Next →</span>
          {data.next.title}
        </a>
      {/if}
    </div>
  </nav>
</main>
