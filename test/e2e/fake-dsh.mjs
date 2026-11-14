// A scripted stand-in for DeepSeek Harness (`dsh --profile acp`), used only by the end-to-end tests
// (LOCALCLAUDE_DSH points here). It speaks ACP over stdio like the real one: initialize,
// session/new|resume|prompt|cancel|close|set_config_option, session/update and session/request_permission.
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'

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

const MODELS = [
  { value: '["deepseek-official","deepseek-v4-flash"]', name: 'deepseek-v4-flash' },
  { value: '["deepseek-official","deepseek-v4-pro"]', name: 'DeepSeek-V4-Pro', description: 'Stronger' }
]
const state = { model: MODELS[0].value, effort: 'high' }
const config = () => [
  { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: state.model, options: [{ group: 'deepseek-official', name: 'DeepSeek', options: MODELS }] },
  {
    id: 'reasoning_effort',
    name: 'Reasoning effort',
    category: 'thought_level',
    type: 'select',
    currentValue: state.effort,
    options: ['off', 'low', 'high', 'max'].map((v) => ({ value: v, name: v }))
  }
]
const cancelled = new Set()

const update = (sessionId, u) => send({ method: 'session/update', params: { sessionId, update: u } })
const say = (sessionId, text) => update(sessionId, { sessionUpdate: 'agent_message_chunk', messageId: randomUUID(), content: { type: 'text', text } })

async function prompt(id, { sessionId, prompt: blocks }) {
  const all = blocks.map((b) => b.text ?? '').join('\n')
  const text = blocks.at(-1)?.text ?? ''
  const t = text.toLowerCase()
  update(sessionId, { sessionUpdate: 'agent_thought_chunk', messageId: randomUUID(), content: { type: 'text', text: 'Thinking it over.' } })
  if (t.includes('run a command')) {
    say(sessionId, 'Let me look.')
    update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 'call_ls', title: 'bash', kind: 'other', status: 'in_progress', rawInput: { description: 'List the files', command: 'ls' } })
    await sleep(100)
    update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'call_ls', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'alpha.txt\nbeta.txt' } }] })
    say(sessionId, 'There are two files.')
  } else if (t.includes('write outside')) {
    const input = { file_path: '/elsewhere/note.txt', content: 'x', sandbox_permissions: 'danger-full-access', justification: 'The note belongs in /elsewhere' }
    update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 'call_w', title: 'write', kind: 'other', status: 'in_progress', rawInput: input })
    const r = await ask('session/request_permission', {
      sessionId,
      toolCall: { toolCallId: 'call_w' },
      options: [
        { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' }
      ]
    })
    const ok = r?.outcome?.outcome === 'selected' && r.outcome.optionId === 'allow-once'
    update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'call_w', status: ok ? 'completed' : 'failed', content: [{ type: 'content', content: { type: 'text', text: ok ? 'Created file' : 'The user rejected this' } }] })
    say(sessionId, ok ? 'Wrote the note outside.' : 'I wasn’t allowed to write there.')
  } else if (t.includes('slow')) {
    for (let i = 0; i < 40 && !cancelled.has(sessionId); i++) await sleep(100)
    if (cancelled.delete(sessionId)) return send({ id, result: { stopReason: 'cancelled' } })
    say(sessionId, 'Done slowly.')
  } else if (t.includes('what do you know')) {
    const env = `mode=${process.env.DSH_PERMISSION_MODE} key=${process.env.DEEPSEEK_API_KEY ? 'yes' : 'no'} node=${process.env.ELECTRON_RUN_AS_NODE ? 'electron' : 'other'}`
    say(sessionId, `DeepSeek facts: ${env} model=${JSON.parse(state.model)[1]} effort=${state.effort} context=${all.includes('<previous_conversation>') ? 'yes' : 'no'}`)
  } else {
    say(sessionId, `DeepSeek says: ${text}` + (all.includes('<previous_conversation>') ? ' (with earlier messages)' : ''))
  }
  update(sessionId, { sessionUpdate: 'usage_update', used: 4200, size: 100000 })
  send({ id, result: { stopReason: 'end_turn' } })
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
      return send({ id: m.id, result: { protocolVersion: 1, agentInfo: { name: 'fake-dsh', version: '0.0.0' }, agentCapabilities: { sessionCapabilities: { resume: {}, close: {} } }, authMethods: [] } })
    case 'session/new':
      return send({ id: m.id, result: { sessionId: 'ds-' + randomUUID(), configOptions: config() } })
    case 'session/resume':
      if (String(p.sessionId).includes('gone')) return send({ id: m.id, error: { code: -32602, message: 'unknown session' } })
      return send({ id: m.id, result: { configOptions: config() } })
    case 'session/set_config_option':
      if (p.configId === 'model') state.model = p.value
      if (p.configId === 'reasoning_effort') state.effort = p.value
      return send({ id: m.id, result: { configOptions: config() } })
    case 'session/prompt':
      void prompt(m.id, p)
      return
    case 'session/cancel':
      cancelled.add(p.sessionId)
      return
    case 'session/close':
      return send({ id: m.id, result: {} })
    default:
      if (m.id !== undefined) send({ id: m.id, error: { code: -32601, message: 'no such method' } })
  }
})
