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
    apiReply = data ? `${data.message} — ${data.docs_hint}` : '(request failed)'
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

<main>
  <h1>FastAPI ↔ Svelte demo</h1>
  <p class="served">This page was served by: <strong>{servedBy}</strong></p>

  <section>
    <h2>1. HTTP — FastAPI owns <code>/api/*</code></h2>
    <button onclick={callApi}>GET /api/hello</button>
    <pre>{apiReply}</pre>
  </section>

  <section>
    <h2>2. WebSocket — FastAPI owns <code>/ws</code></h2>
    <p class="status" data-state={wsState}>{wsState}</p>
    {#if wsState === 'disconnected'}
      <button onclick={connectWs}>Connect</button>
    {:else}
      <input bind:value={wsInput} />
      <button onclick={sendWs}>Send</button>
    {/if}
    <pre>{wsLog.join('\n')}</pre>
  </section>

  <section>
    <h2>3. Routing — the page owns everything else</h2>
    <p>
      Try <a href="/api/hello" target="_blank">/api/hello</a> (FastAPI wins — path
      operations are checked first) vs
      <a href="/anything/else" target="_blank">/anything/else</a> (no route matches,
      so the <code>fallback="index.html"</code> serves this page again — that's the
      hook a client-side router would use).
    </p>
  </section>
</main>
