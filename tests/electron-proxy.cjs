const { app, session } = require('electron')
const http = require('node:http')
const net = require('node:net')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const load = require('./load-source.cjs')

// Not under out/: electron-builder packs everything there into the app
const data = path.join(os.tmpdir(), 'shiping-proxy-test')
fs.mkdirSync(data, { recursive: true })
app.setPath('userData', data)
const servers = [],
  sockets = new Set()
async function listen(server) {
  servers.push(server)
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return server.address().port
}

app
  .whenReady()
  .then(async () => {
    const { fetchWithProxy, getProxySession, testProxyConnection, detectSystemProxy } =
      load('src/main/proxy.ts')
    const requests = []
    const origin = http.createServer((req, res) => {
      requests.push({
        url: req.url,
        auth: req.headers.authorization,
        custom: req.headers['x-fixture']
      })
      if (req.url.startsWith('/slow')) {
        const timer = setTimeout(() => res.end('{}'), 300)
        res.on('close', () => clearTimeout(timer))
      } else if (req.url === '/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write('first\n')
        const timer = setTimeout(() => res.end('last\n'), 200)
        res.on('close', () => clearTimeout(timer))
      } else {
        res.writeHead(req.url === '/unauthorized/models' ? 401 : 200, {
          'Content-Type': 'application/json'
        })
        res.end(JSON.stringify({ data: [{ id: 'fixture-model' }] }))
      }
    })
    const port = await listen(origin)
    let proxyHits = 0
    const makeHTTPProxy = () =>
      http.createServer((req, res) => {
        proxyHits++
        const url = new URL(req.url)
        const forwarded = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path: url.pathname,
            method: req.method,
            headers: req.headers
          },
          (response) => {
            res.writeHead(response.statusCode, response.headers)
            response.pipe(res)
          }
        )
        forwarded.on('error', () => res.destroy())
        req.pipe(forwarded)
      })
    const proxyPort = await listen(makeHTTPProxy())
    const secondPort = await listen(makeHTTPProxy())
    const custom = { mode: 'custom', url: `http://127.0.0.1:${proxyPort}` }
    const target = `http://shiping-proxy-fixture.invalid:${port}`
    const directTarget = `http://127.0.0.1:${port}`
    let result = await testProxyConnection(custom, {
      apiBaseURL: target,
      apiKey: 'fixture-key',
      apiHeaders: 'X-Fixture: custom-value'
    })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.match(result.route, new RegExp(`PROXY 127.0.0.1:${proxyPort}`))
    assert.equal(proxyHits, 1)
    assert.equal(requests[0].auth, 'Bearer fixture-key')
    assert.equal(requests[0].custom, 'custom-value')
    console.log('PASS native HTTP proxy, headers and connectivity test')

    const response = await fetchWithProxy(custom, `${target}/stream`)
    const second = { mode: 'custom', url: `http://127.0.0.1:${secondPort}` }
    result = await testProxyConnection(second, { apiBaseURL: target })
    assert.equal(result.ok, true)
    assert.match(result.route, new RegExp(`:${secondPort}`))
    assert.equal(await response.text(), 'first\nlast\n')
    assert.notEqual(await getProxySession(custom), await getProxySession(second))
    console.log('PASS changing proxy ports and testing drafts preserve active streams')

    let socksHits = 0
    const socks = net.createServer((socket) => {
      socket.once('data', (greeting) => {
        assert.equal(greeting[0], 5)
        socket.write(Buffer.from([5, 0]))
        socket.once('data', (request) => {
          assert.equal(request[0], 5)
          assert.equal(request[1], 1)
          socksHits++
          const upstream = net.connect(port, '127.0.0.1', () => {
            socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]))
            socket.pipe(upstream).pipe(socket)
          })
          sockets.add(upstream)
          upstream.on('close', () => sockets.delete(upstream))
          upstream.on('error', () => socket.destroy())
          socket.on('close', () => upstream.destroy())
        })
      })
    })
    const socksPort = await listen(socks)
    result = await testProxyConnection(
      { mode: 'custom', url: `socks5://127.0.0.1:${socksPort}` },
      { apiBaseURL: target }
    )
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.ok(socksHits > 0)
    assert.match(result.route, /SOCKS5/)
    console.log('PASS native SOCKS5 proxy with remote hostname resolution')

    result = await testProxyConnection({ mode: 'direct' }, { apiBaseURL: directTarget })
    assert.equal(result.ok, true)
    assert.equal(result.route, 'DIRECT')
    result = await testProxyConnection({ mode: 'system' }, { apiBaseURL: directTarget })
    assert.equal(result.ok, true)
    const detected = await detectSystemProxy(directTarget)
    assert.equal(detected.route, 'DIRECT')
    assert.equal(detected.error, undefined)
    assert.equal(await session.defaultSession.resolveProxy(directTarget), 'DIRECT')
    const beforeLoopback = proxyHits
    result = await testProxyConnection(custom, { apiBaseURL: directTarget })
    assert.equal(result.ok, true)
    assert.equal(result.route, 'DIRECT')
    assert.equal(proxyHits, beforeLoopback)
    console.log('PASS native direct/system modes and detection, default session untouched')

    result = await testProxyConnection(
      { mode: 'direct' },
      { apiBaseURL: `${directTarget}/unauthorized` }
    )
    assert.equal(result.reachable, true)
    assert.equal(result.ok, false)
    assert.equal(result.status, 401)
    assert.match(result.message, /Key/)
    result = await testProxyConnection(
      { mode: 'direct' },
      { apiBaseURL: `${directTarget}/slow` },
      40
    )
    assert.equal(result.reachable, false)
    assert.match(result.message, /超时/)
    assert.ok(result.elapsedMs < 1000)
    const abort = new AbortController()
    const pending = fetchWithProxy({ mode: 'direct' }, `${directTarget}/slow`, {
      signal: abort.signal
    })
    setTimeout(() => abort.abort(), 20)
    await assert.rejects(pending)
    await assert.rejects(() => fetchWithProxy({ mode: 'direct' }, 'file:///fixture'))
    console.log('PASS API errors, bounded timeout, cancellation and non-HTTP rejection')

    // Use a just-closed listening socket, avoiding assumptions about free ports.
    const closed = net.createServer()
    const closedPort = await listen(closed)
    await new Promise((resolve) => closed.close(resolve))
    result = await testProxyConnection(
      { mode: 'custom', url: `http://127.0.0.1:${closedPort}` },
      { apiBaseURL: target }
    )
    assert.equal(result.reachable, false)
    assert.match(result.message, /代理/)
    console.log('PASS unavailable custom proxy fails without silently bypassing it')
    console.log('All native Electron proxy checks passed')
  })
  .then(() => {
    for (const socket of sockets) socket.destroy()
    for (const server of servers) server.close()
    app.exit(0)
  })
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
