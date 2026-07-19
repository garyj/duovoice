<script lang="ts">
  let { ok, label }: { ok: boolean; label: string } = $props()
</script>

<p class="flex items-center gap-2">
  <span class={['status', ok ? 'status-success' : 'status-error']}></span>
  {label}
</p>
