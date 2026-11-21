// JSON for the browser version's API calls. Plain JSON turns `undefined` arguments into null (or drops
// them), which changes what optional parameters receive, so undefined travels as a marker instead.
const UNDEF = { $undefined: 1 }

export function encodeWire(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => (v === undefined ? UNDEF : v))
}

export function decodeWire(text: string): unknown {
  return JSON.parse(text, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) && (v as Record<string, unknown>).$undefined === 1 && Object.keys(v).length === 1 ? undefined : v
  )
}
