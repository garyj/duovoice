<script lang="ts">
  let { text, tall = false }: { text: string; tall?: boolean } = $props()
</script>

<pre class={[tall ? 'min-h-24' : 'min-h-12', 'rounded bg-base-300 p-3 text-sm whitespace-pre-wrap break-all']}>{text}</pre>
