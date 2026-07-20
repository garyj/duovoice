<script lang="ts">
  import { tick } from 'svelte'
  import { TranslatorSession, type RelayFrame } from '$lib/audio'
  import { Button, ChatBubble } from '$lib/components'

  /** A stream silent for this long gets a fresh bubble on its next delta. */
  const BUBBLE_GAP_MS = 2500

  type CallState = 'idle' | 'connecting' | 'live' | 'ended'

  interface FeedEntry {
    id: number
    /** 'heard' for the mic transcript, otherwise a translation lang ('pt', 'en'). */
    stream: string
    text: string
  }

  let callState = $state<CallState>('idle')
  let errorMessage = $state('')
  let warning = $state('')
  let feed = $state<FeedEntry[]>([])
  let feedEl = $state<HTMLElement | null>(null)

  let session: TranslatorSession | null = null
  let nextId = 0
  /** Per-stream position of the open bubble in the feed and its last delta time. */
  let cursors: Record<string, { index: number; last: number }> = {}

  function appendDelta(stream: string, text: string) {
    const now = Date.now()
    const cursor = cursors[stream]
    if (cursor && now - cursor.last <= BUBBLE_GAP_MS) {
      feed[cursor.index].text += text
      cursor.last = now
    } else {
      feed.push({ id: nextId++, stream, text })
      cursors[stream] = { index: feed.length - 1, last: now }
    }
  }

  function handleFrame(frame: RelayFrame) {
    if (frame.type === 'transcript_in') {
      appendDelta('heard', frame.text)
    } else if (frame.type === 'transcript_out') {
      appendDelta(frame.lang, frame.text)
    } else if (frame.type === 'status') {
      if (frame.state === 'ended' && callState === 'live') {
        const direction = frame.lang ? `The ${frame.lang.toUpperCase()} direction` : 'A translation direction'
        warning = `${direction} dropped. Stop and start the call again to bring it back.`
      }
    } else if (frame.type === 'error') {
      errorMessage = frame.lang ? `${frame.lang.toUpperCase()}: ${frame.message}` : frame.message
    }
  }

  async function startCall() {
    callState = 'connecting'
    errorMessage = ''
    warning = ''
    feed = []
    cursors = {}
    const starting = new TranslatorSession()
    starting.onframe = handleFrame
    starting.onclose = () => {
      session = null
      if (callState !== 'idle') callState = 'ended'
    }
    session = starting
    try {
      await starting.start()
      if (session === starting) callState = 'live'
      else starting.stop() // stopped mid-connect; tear down the late-arriving session
    } catch (err) {
      if (session === starting) {
        session = null
        errorMessage = err instanceof Error ? err.message : String(err)
        callState = 'idle'
      }
    }
  }

  function stopCall() {
    session?.stop()
    session = null
    callState = 'ended'
  }

  $effect.pre(() => {
    // Reference every bubble's text so this re-runs as deltas stream in.
    for (const entry of feed) void entry.text
    if (!feedEl) return
    // Follow the feed only if the user was already at the bottom.
    if (feedEl.offsetHeight + feedEl.scrollTop > feedEl.scrollHeight - 40) {
      tick().then(() => feedEl?.scrollTo(0, feedEl.scrollHeight))
    }
  })
</script>

<main class="mx-auto flex h-dvh max-w-2xl flex-col gap-4 p-6">
  <header class="flex items-center justify-between">
    <h1>Sther</h1>
    <div class="flex items-center gap-2 text-sm text-base-content/70">
      {#if callState === 'live'}
        <span class="inline-grid *:[grid-area:1/1]">
          <span class="status status-success animate-ping"></span>
          <span class="status status-success"></span>
        </span>
        live
      {:else if callState === 'connecting'}
        <span class="status status-warning"></span>
        connecting
      {:else if callState === 'ended'}
        <span class="status status-error"></span>
        ended
      {:else}
        <span class="status"></span>
        idle
      {/if}
    </div>
  </header>

  {#if errorMessage}
    <div role="alert" class="alert alert-error">
      <span>{errorMessage}</span>
    </div>
  {/if}

  {#if warning}
    <div role="alert" class="alert alert-warning">
      <span>{warning}</span>
    </div>
  {/if}

  <div bind:this={feedEl} class="flex-1 overflow-y-auto rounded-box bg-base-200 p-4">
    {#if feed.length === 0}
      {#if callState === 'live'}
        <p class="text-base-content/60">Both directions are live - speak.</p>
      {:else if callState === 'connecting'}
        <p class="text-base-content/60">Connecting to the relay...</p>
      {:else}
        <p class="text-base-content/60">
          Sther listens to the room and speaks live translations both ways: English becomes
          Portuguese, Portuguese becomes English. Press Start to open both directions.
        </p>
      {/if}
    {:else}
      {#each feed as entry (entry.id)}
        <ChatBubble
          side={entry.stream === 'heard' ? 'start' : 'end'}
          header={entry.stream === 'heard' ? 'heard' : entry.stream.toUpperCase()}
          primary={entry.stream !== 'heard'}
          text={entry.text}
        />
      {/each}
    {/if}
  </div>

  <div class="flex gap-2">
    {#if callState === 'connecting'}
      <Button disabled>
        <span class="loading loading-spinner"></span>
        Connecting
      </Button>
    {:else if callState !== 'live'}
      <Button onclick={startCall}>Start</Button>
    {/if}
    {#if callState === 'connecting' || callState === 'live'}
      <Button variant="default" onclick={stopCall}>Stop</Button>
    {/if}
  </div>
</main>
