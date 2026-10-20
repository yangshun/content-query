<script setup lang="ts">
const { data: entries } = await useAsyncData("benchmark-index", () =>
  queryCollection("entries")
    .select("id", "path", "title", "description")
    .order("order", "ASC")
    .all(),
);
</script>

<template>
  <main v-if="entries" :data-benchmark-count="entries.length">
    <h1>Nuxt Content</h1>
    <p>{{ entries.length }} entries</p>
    <p>
      Final entry: <span data-benchmark-last>{{ entries.at(-1)?.title }}</span>
    </p>
    <h2>All entries</h2>
    <ol data-benchmark-index>
      <li v-for="entry in entries" :key="entry.id">
        <NuxtLink :to="entry.path">{{ entry.title }}</NuxtLink>
        <p>{{ entry.description }}</p>
      </li>
    </ol>
  </main>
</template>
