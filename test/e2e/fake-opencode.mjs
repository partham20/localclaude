// A scripted stand-in for OpenCode (`opencode acp`), used only by the tests (LOCALCLAUDE_OPENCODE
// points here). It speaks ACP over stdio the way OpenCode 2.3 does: tool calls carry OpenCode's own
// tool name beside a human title, the input arrives in a later update, permission requests follow
// the rules in OPENCODE_CONFIG_CONTENT, and a model list depends on the provider keys it was given.
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'

if (process.argv.at(-1) !== 'acp') {
  process.stderr.write('fake-opencode: expected the acp command\n')
  process.exit(2)
}

const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let nextId = 0
const waits = new Map()
const ask = (method, params) =>
  new Promise((resolve) => {
    const id = nextId++
    waits.set(id, resolve)
    send({ id, method, params })
  })

const config = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT || '{}')
const rules = config.permissions ?? []
/** OpenCode's rule evaluation: the last matching rule wins, and nothing matching means ask */
const effect = (action) => [...rules].reverse().find((r) => r.action === action || r.action === '*')?.effect ?? 'allow'

const MODELS = [
  { value: 'opencode/big-pickle', name: 'opencode/Big Pickle' },
  { value: 'opencode/glm-5.3-flash-free', name: 'opencode/GLM-5.3 Flash (free)' },
  ...(process.env.OPENAI_API_KEY ? [{ value: 'openai/gpt-5.5', name: 'openai/GPT-5.5' }] : []),
  ...(process.env.DEEPSEEK_API_KEY ? [{ value: 'deepseek/deepseek-flash', name: 'deepseek/DeepSeek Flash' }] : [])
]
const state = { model: 'opencode/big-pickle', mode: 'build' }
const configOptions = () => [
  { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: state.model, options: MODELS },
  {
    id: 'mode',
    name: 'Session Mode',
    category: 'mode',
    type: 'select',
    currentValue: state.mode,
    options: [
      { value: 'build', name: 'Build' },
      { value: 'plan', name: 'Plan' }
    ]
  }
]
const cancelled = new Set()
const update = (sessionId, u) => send({ method: 'session/update', params: { sessionId, update: u } })
const say = (sessionId, text) => update(sessionId, { sessionUpdate: 'agent_message_chunk', messageId: 'msg_' + randomUUID(), content: { type: 'text', text } })

async function permitted(sessionId, toolCallId, action, toolCall) {
  const e = effect(action)
  if (e === 'allow') return true
  if (e === 'deny') return false
  const r = await ask('session/request_permission', {
    sessionId,
    toolCall: { toolCallId, ...toolCall },
    options: [
      { optionId: 'once', kind: 'allow_once', name: 'Allow once' },
      { optionId: 'always', kind: 'allow_always', name: 'Always allow' },
      { optionId: 'reject', kind: 'reject_once', name: 'Reject' }
    ]
  })
  return r?.outcome?.outcome === 'selected' && r.outcome.optionId !== 'reject'
}

async function prompt(id, { sessionId, prompt: blocks }) {
  const all = blocks.map((b) => b.text ?? '').join('\n')
  const text = blocks.filter((b) => b.type === 'text').at(-1)?.text ?? ''
  const t = text.toLowerCase()
  const images = blocks.filter((b) => b.type === 'image').length
  update(sessionId, { sessionUpdate: 'agent_thought_chunk', messageId: 'msg_t' + randomUUID(), content: { type: 'text', text: 'Considering.' } })
  if (t.includes('run a command')) {
    const call = 'call_shell_' + randomUUID().slice(0, 6)
    update(sessionId, { sessionUpdate: 'tool_call', toolCallId: call, name: 'shell', title: 'shell', kind: 'execute', status: 'pending', rawInput: { cwd: process.cwd() } })
    const input = { command: 'ls', cwd: process.cwd() }
    update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: call, status: 'in_progress', kind: 'execute', title: 'ls', rawInput: input })
    const ok = await permitted(sessionId, call, 'shell', { name: 'shell', title: 'ls', kind: 'execute', status: 'pending', rawInput: input })
    if (ok) {
      update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: call, status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'gamma.txt\ndelta.txt\n' } }] })
      say(sessionId, 'OpenCode found two files.')
    } else {
      update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: call, status: 'failed', content: [{ type: 'content', content: { type: 'text', text: 'The user rejected permission to use this tool' } }] })
      say(sessionId, 'OpenCode wasn’t allowed to run it.')
    }
  } else if (t.includes('edit a file')) {
    const call = 'call_edit_' + randomUUID().slice(0, 6)
    const input = { path: 'notes.txt', oldString: 'old line', newString: 'new line' }
    update(sessionId, { sessionUpdate: 'tool_call', toolCallId: call, name: 'edit', title: 'notes.txt', kind: 'edit', status: 'pending', rawInput: input })
    const ok = await permitted(sessionId, call, 'edit', { name: 'edit', title: 'notes.txt', kind: 'edit', rawInput: input })
    update(sessionId, {
      sessionUpdate: 'tool_call_update',
      toolCallId: call,
      status: ok ? 'completed' : 'failed',
      content: ok ? [{ type: 'diff', path: 'notes.txt', oldText: 'old line', newText: 'new line' }] : [{ type: 'content', content: { type: 'text', text: 'rejected' } }]
    })
    say(sessionId, ok ? 'Edited notes.txt.' : 'Not allowed to edit.')
  } else if (t.includes('flaky')) {
    update(sessionId, { sessionUpdate: 'session_info_update', _meta: { 'opencode/retry': { attempt: 2, error: { type: 'provider.transport', message: 'overloaded' } } } })
    await sleep(50)
    update(sessionId, { sessionUpdate: 'session_info_update', _meta: { 'opencode/retry': null } })
    say(sessionId, 'Worked on the second try.')
  } else if (t.includes('slow')) {
    for (let i = 0; i < 40 && !cancelled.has(sessionId); i++) await sleep(100)
    if (cancelled.delete(sessionId)) return send({ id, result: { stopReason: 'cancelled' } })
    say(sessionId, 'Done slowly.')
  } else if (t.includes('what do you know')) {
    const facts = [
      `model=${state.model}`,
      `mode=${state.mode}`,
      `rules=${rules.map((r) => `${r.action}:${r.effect}`).join(',')}`,
      `update=${config.update}`,
      `openai=${process.env.OPENAI_API_KEY ? 'yes' : 'no'}`,
      `autoupdate=${process.env.OPENCODE_DISABLE_AUTOUPDATE ? 'off' : 'on'}`,
      `images=${images}`,
      `skills=${all.includes('<context>') ? 'context' : 'none'}`,
      `context=${all.includes('<previous_conversation>') ? 'yes' : 'no'}`
    ]
    say(sessionId, `OpenCode facts: ${facts.join(' ')}`)
  } else {
    say(sessionId, `OpenCode says: ${text}` + (all.includes('<previous_conversation>') ? ' (with earlier messages)' : ''))
  }
  update(sessionId, { sessionUpdate: 'usage_update', used: 5100, size: 200000, cost: { amount: 0.001, currency: 'USD' } })
  send({ id, result: { stopReason: 'end_turn', usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 } } })
}

createInterface({ input: process.stdin }).on('line', (line) => {
  let m
  try {
    m = JSON.parse(line)
  } catch {
    return
  }
  if (m.method === undefined && m.id !== undefined) {
    waits.get(m.id)?.(m.result)
    waits.delete(m.id)
    return
  }
  const p = m.params ?? {}
  switch (m.method) {
    case 'initialize':
      return send({
        id: m.id,
        result: {
          protocolVersion: 1,
          agentInfo: { name: 'OpenCode', version: '0.0.0-fake' },
          agentCapabilities: { loadSession: true, promptCapabilities: { image: true }, mcpCapabilities: { http: true, sse: false }, sessionCapabilities: { resume: {}, close: {} } },
          authMethods: [{ id: 'opencode-login', name: 'Login with opencode' }]
        }
      })
    case 'session/new':
      return send({ id: m.id, result: { sessionId: 'ses_' + randomUUID().replace(/-/g, ''), configOptions: configOptions() } })
    case 'session/resume':
      if (String(p.sessionId).includes('gone')) return send({ id: m.id, error: { code: -32602, message: 'Session not found' } })
      return send({ id: m.id, result: { configOptions: configOptions() } })
    case 'session/set_config_option':
      if (p.configId === 'model') {
        if (!MODELS.some((x) => x.value === p.value))
          return send({ id: m.id, error: { code: -32602, message: `Invalid params: model not found: ${p.value}`, data: { modelId: p.value } } })
        state.model = p.value
      }
      if (p.configId === 'mode') state.mode = p.value
      return send({ id: m.id, result: { configOptions: configOptions() } })
    case 'session/prompt':
      void prompt(m.id, p)
      return
    case 'session/cancel':
      cancelled.add(p.sessionId)
      return
    case 'session/close':
      return send({ id: m.id, result: {} })
    default:
      if (m.id !== undefined) send({ id: m.id, error: { code: -32601, message: 'Method not found' } })
  }
})
