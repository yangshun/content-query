<script lang="ts">
  let { data }: import("./$types").PageProps = $props();
</script>

<svelte:head>
  <title>Documentation | ContentQuery x SvelteKit</title>
  <meta name="description" content="Sample guides for keeping project notes organized and working with your team." />
</svelte:head>

<main class="home" id="main-content" tabindex="-1">
  <div class="home-intro">
    <h1>Documentation</h1>
    <p>Sample guides for keeping project notes organized and working with your team.</p>
  </div>
  <section class="guide-index" aria-labelledby="guides-heading">
    <h2 id="guides-heading">Guides</h2>
    <ol class="guide-list">
      {#each data.guides as guide, index (guide.id)}
        <li>
          <a class="guide-row" href={`/docs/${guide.id}/`}>
            <span class="guide-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <div>
              <h3>{guide.title}</h3>
              <p>{guide.description}</p>
            </div>
            <span class="guide-arrow" aria-hidden="true">→</span>
          </a>
        </li>
      {/each}
    </ol>
  </section>
</main>
