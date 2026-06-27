export function extractJSON(src: string, startIdx: number): string | null {
  let depth = 0, inStr = false, esc = false
  for (let i = startIdx; i < src.length; i++) {
    const ch = src[i]
    if (esc) { esc = false; continue }
    if (ch === '\\') { esc = true; continue }
    if (ch === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return src.substring(startIdx, i + 1)
    }
  }
  return null
}

export function safeParseJSON(s: string): Record<string, unknown> | null {
  try { return JSON.parse(s) } catch {}
  let fixed = ''
  let inStr = false, esc = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (esc) { fixed += ch; esc = false; continue }
    if (ch === '\\') { fixed += ch; esc = true; continue }
    if (ch === '"') { fixed += ch; inStr = !inStr; continue }
    if (inStr) {
      if (ch === '\n') { fixed += '\\n'; continue }
      if (ch === '\r') { fixed += '\\r'; continue }
      if (ch === '\t') { fixed += '\\t'; continue }
    }
    fixed += ch
  }
  try { return JSON.parse(fixed) } catch (e2) {
    console.error('safeParseJSON failed:', (e2 as Error).message, 'input:', s.substring(0, 200))
    return null
  }
}

export function extractAllBlocks(src: string, key: string): string[] {
  const blocks: string[] = []
  const searchKey = '{"' + key + '":'
  let idx = 0
  while ((idx = src.indexOf(searchKey, idx)) !== -1) {
    const block = extractJSON(src, idx)
    if (block) { blocks.push(block); idx += block.length }
    else idx++
  }
  return blocks
}
