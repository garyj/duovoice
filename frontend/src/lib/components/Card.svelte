<script lang="ts">
  import type { Snippet } from 'svelte'

  let { title, children }: { title: string; children: Snippet } = $props()
</script>

<section class="card bg-base-200">
  <div class="card-body">
    <h2>{title}</h2>
    {@render children()}
  </div>
</section>
