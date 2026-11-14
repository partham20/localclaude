// A remote MCP server that wants OAuth, for the Connectors steps: protected-resource and authorization-server
// metadata, dynamic client registration, an authorize endpoint that signs you straight in, a token endpoint
// (with refresh), and /mcp, which answers only with the token it gave out.
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const sdk = (p) => import(pathToFileURL(resolve('node_modules/@modelcontextprotocol/sdk/dist/esm', p)).href)

export async function startOAuthMcp() {
  const { Server } = await sdk('server/index.js')
  const { StreamableHTTPServerTransport } = await sdk('server/streamableHttp.js')
  const { ListToolsRequestSchema } = await sdk('types.js')
  const state = { registered: 0, tokens: 0, refreshed: 0, access: 'access-1', lastAuthorization: '' }
  let base = ''
  const json = (res, code, body, headers = {}) => {
    res.writeHead(code, { 'content-type': 'application/json', ...headers })
    res.end(JSON.stringify(body))
  }
  const readBody = (req) =>
    new Promise((r) => {
      let b = ''
      req.on('data', (d) => (b += d))
      req.on('end', () => r(b))
    })
  const server = createServer(async (req, res) => {
    const u = new URL(req.url, base)
    if (u.pathname.startsWith('/.well-known/oauth-protected-resource')) return json(res, 200, { resource: `${base}/mcp`, authorization_servers: [base] })
    if (u.pathname.startsWith('/.well-known/oauth-authorization-server') || u.pathname.startsWith('/.well-known/openid-configuration'))
      return json(res, 200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none']
      })
    if (u.pathname === '/register' && req.method === 'POST') {
      const meta = JSON.parse((await readBody(req)) || '{}')
      state.registered++
      return json(res, 201, { ...meta, client_id: `client-${state.registered}`, client_id_issued_at: Math.floor(Date.now() / 1000) })
    }
    if (u.pathname === '/authorize') {
      const to = new URL(u.searchParams.get('redirect_uri'))
      to.searchParams.set('code', 'the-code')
      to.searchParams.set('state', u.searchParams.get('state') ?? '')
      res.writeHead(302, { location: to.href })
      return res.end()
    }
    if (u.pathname === '/token' && req.method === 'POST') {
      const p = new URLSearchParams(await readBody(req))
      if (p.get('grant_type') === 'authorization_code' && p.get('code') === 'the-code' && p.get('code_verifier')) {
        state.tokens++
        return json(res, 200, { access_token: state.access, token_type: 'Bearer', expires_in: 3600, refresh_token: 'refresh-1' })
      }
      if (p.get('grant_type') === 'refresh_token' && p.get('refresh_token') === 'refresh-1') {
        state.refreshed++
        state.access = `access-${state.refreshed + 1}`
        return json(res, 200, { access_token: state.access, token_type: 'Bearer', expires_in: 3600 })
      }
      return json(res, 400, { error: 'invalid_grant' })
    }
    if (u.pathname === '/mcp') {
      state.lastAuthorization = req.headers.authorization ?? ''
      if (req.headers.authorization !== `Bearer ${state.access}`)
        return json(res, 401, { error: 'invalid_token' }, { 'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` })
      const mcp = new Server({ name: 'e2e-secure', version: '1.0.0' }, { capabilities: { tools: {} } })
      mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'secret_tool', description: 'Only for signed-in users', inputSchema: { type: 'object', properties: {} } }] }))
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
      res.on('close', () => {
        void transport.close()
        void mcp.close()
      })
      await mcp.connect(transport)
      const body = req.method === 'POST' ? JSON.parse((await readBody(req)) || 'null') : undefined
      return transport.handleRequest(req, res, body)
    }
    res.writeHead(404).end()
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
  return { url: `${base}/mcp`, base, state, close: () => new Promise((r) => server.close(r)) }
}
