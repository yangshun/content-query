<script setup lang="ts">
const route = useRoute();
const path = `/entries/${String(route.params.id)}`;
const { data: entry } = await useAsyncData(path, () =>
  queryCollection("entries").path(path).first(),
);
if (!entry.value) {
  throw createError({ statusCode: 404, statusMessage: "Entry not found" });
}
useHead({ title: entry.value.title });
</script>

<template>
  <main v-if="entry" :data-benchmark-entry="String(route.params.id)">
    <NuxtLink to="/">All entries</NuxtLink>
    <h1 data-benchmark-title>{{ entry.title }}</h1>
    <p data-benchmark-description>{{ entry.description }}</p>
    <article><ContentRenderer :value="entry" /></article>
  </main>
</template>
