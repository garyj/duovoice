<script lang="ts">
  let {
    side,
    header,
    primary = false,
    text,
  }: {
    side: 'start' | 'end'
    header: string
    primary?: boolean
    text: string
  } = $props()
</script>

<div class={['chat', side === 'start' ? 'chat-start' : 'chat-end']}>
  <div class="chat-header opacity-50">{header}</div>
  <div class={['chat-bubble', primary && 'chat-bubble-primary']}>{text}</div>
</div>
