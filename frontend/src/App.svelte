<script lang="ts">
  import { getHello } from './client'

  const servedBy = location.port === '5173' ? 'Vite dev server (proxying to FastAPI on :8000)' : 'FastAPI via app.frontend()'

  let apiReply = $state('(not called yet)')
  let wsState = $state<'disconnected' | 'connected'>('disconnected')
  let wsInput = $state('hello over the socket')
  let wsLog = $state<string[]>([])
  let ws: WebSocket | null = null

  async function callApi() {
    // generated function: URL, method, and response type all come from the schema
    const { data } = await getHello()
    apiReply = data ? `${data.message} — ${data.docs_url}` : '(request failed)'
  }

  function connectWs() {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${scheme}://${location.host}/ws`)
    ws.onopen = () => (wsState = 'connected')
    ws.onclose = () => (wsState = 'disconnected')
    ws.onmessage = (e) => (wsLog = [...wsLog, `← ${e.data}`])
  }

  function sendWs() {
    if (ws?.readyState !== WebSocket.OPEN) return
    ws.send(wsInput)
    wsLog = [...wsLog, `→ ${wsInput}`]
  }
</script>

<main class="mx-auto flex max-w-2xl flex-col gap-6 p-6 py-12">
  <header>
    <h1 class="text-3xl font-semibold tracking-tight">FastAPI ↔ Svelte demo</h1>
    <p class="mt-2 text-sm text-base-content/70">
      This page was served by: <strong class="font-medium text-primary">{servedBy}</strong>
    </p>
  </header>

  <section class="card bg-base-200">
    <div class="card-body">
      <h2 class="card-title text-base">1. HTTP — FastAPI owns <code>/api/*</code></h2>
      <button class="btn btn-primary self-start" onclick={callApi}>GET /api/hello</button>
      <pre class="min-h-12 rounded bg-base-300 p-3 text-sm whitespace-pre-wrap break-all">{apiReply}</pre>
    </div>
  </section>

  <section class="card bg-base-200">
    <div class="card-body">
      <h2 class="card-title text-base">2. WebSocket — FastAPI owns <code>/ws</code></h2>
      <p class="flex items-center gap-2 text-sm">
        <span class={['status', wsState === 'connected' ? 'status-success' : 'status-error']}></span>
        {wsState}
      </p>
      {#if wsState === 'disconnected'}
        <button class="btn btn-primary self-start" onclick={connectWs}>Connect</button>
      {:else}
        <div class="flex items-center gap-2">
          <input class="input flex-1" bind:value={wsInput} />
          <button class="btn" onclick={sendWs}>Send</button>
        </div>
      {/if}
      <pre class="min-h-24 rounded bg-base-300 p-3 text-sm whitespace-pre-wrap break-all">{wsLog.join('\n')}</pre>
    </div>
  </section>

  <section class="card bg-base-200">
    <div class="card-body">
      <h2 class="card-title text-base">3. Routing — the page owns everything else</h2>
      <p class="text-sm leading-relaxed">
        Try <a class="link link-primary" href="/api/hello" target="_blank">/api/hello</a> (FastAPI wins — path
        operations are checked first) vs
        <a class="link link-primary" href="/anything/else" target="_blank">/anything/else</a> (no route matches,
        so the <code>fallback="index.html"</code> serves this page again — that's the
        hook a client-side router would use).
      </p>
    </div>
  </section>
</main>
