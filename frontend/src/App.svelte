<script lang="ts">
  import { getHello } from './client'
  import { Button, Card, LogPane, StatusDot } from '$lib/components'

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
    <h1>FastAPI ↔ Svelte demo</h1>
    <p class="mt-2 text-base-content/70">
      This page was served by: <strong class="font-medium text-primary">{servedBy}</strong>
    </p>
  </header>

  <Card title="1. HTTP — FastAPI owns /api/*">
    <Button class="self-start" onclick={callApi}>GET /api/hello</Button>
    <LogPane text={apiReply} />
  </Card>

  <Card title="2. WebSocket — FastAPI owns /ws">
    <StatusDot ok={wsState === 'connected'} label={wsState} />
    {#if wsState === 'disconnected'}
      <Button class="self-start" onclick={connectWs}>Connect</Button>
    {:else}
      <div class="flex items-center gap-2">
        <input class="input flex-1" bind:value={wsInput} />
        <Button variant="default" onclick={sendWs}>Send</Button>
      </div>
    {/if}
    <LogPane text={wsLog.join('\n')} tall />
  </Card>

  <Card title="3. Routing — the page owns everything else">
    <p>
      Try <a class="link link-primary" href="/api/hello" target="_blank">/api/hello</a> (FastAPI wins — path
      operations are checked first) vs
      <a class="link link-primary" href="/anything/else" target="_blank">/anything/else</a> (no route matches,
      so the <code>fallback="index.html"</code> serves this page again — that's the
      hook a client-side router would use).
    </p>
  </Card>
</main>
