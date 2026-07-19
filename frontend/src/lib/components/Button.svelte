<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    variant = 'primary',
    onclick,
    disabled,
    class: className,
    children,
  }: {
    variant?: 'primary' | 'default'
    onclick?: (event: MouseEvent) => void
    disabled?: boolean
    class?: string
    children: Snippet
  } = $props()
</script>

<button class={['btn', variant === 'primary' && 'btn-primary', className]} {onclick} {disabled}>
  {@render children()}
</button>
