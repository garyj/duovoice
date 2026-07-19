<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    variant = 'primary',
    onclick,
    class: className,
    children,
  }: {
    variant?: 'primary' | 'default'
    onclick?: (event: MouseEvent) => void
    class?: string
    children: Snippet
  } = $props()
</script>

<button class={['btn', variant === 'primary' && 'btn-primary', className]} {onclick}>
  {@render children()}
</button>
