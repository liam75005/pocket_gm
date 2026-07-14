'use client'

import { Suspense, useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { extractAllBlocks, safeParseJSON } from '@/lib/game/protocol'
import { getSpecies, getClasses, getBackgrounds, ABILITY_LABELS } from '@/lib/game/srd-data'
import { CAMPAIGNS } from '@/lib/game/campaigns'
import { useLang } from '@/lib/i18n/use-lang'
import { getDictionary, fmt, type Dictionary } from '@/lib/i18n/get-dictionary'
import type { Lang } from '@/lib/i18n/config'
import type { PendingRoll, InitiativeEntry, TokenUsage, Character, DynamicStateForAPI, BattleMap, MapToken } from '@/lib/types'
import type { SpeciesData, ClassData, BackgroundData } from '@/lib/game/srd-types'
import { BattleMapCanvas } from '@/components/BattleMapCanvas'

// ─── Types ──────────────────────────────────────────────────────────────────

type Phase = 'select' | 'play'

interface LogMsg {
  id: number
  type: 'dm' | 'pl' | 'roll' | 'sys' | 'cbt'
  text: string
  cls?: string
}

interface G {
  char: Character | null
  hp: number
  hpMax: number
  inv: string[]
  conds: string[]
  notes: string
  gold: number
  history: { role: 'user' | 'assistant'; content: string }[]
  spUsed: Record<number, number>
  dSucc: number
  dFail: number
  pendRoll: PendingRoll | null
  rollsDone: number[]
  rollCnt: number
  inCombat: boolean
  combatRound: number
  initiative: InitiativeEntry[]
  currentTurn: number
  battleMap: BattleMap | null
  awaitingReaction: boolean
  gameEnded: boolean
  causeOfDeath: string
  tokens: TokenUsage
}

function mS(v: number) { const m = Math.floor((v - 10) / 2); return m >= 0 ? `+${m}` : `${m}` }
function rRaw(s: number) { return Math.floor(Math.random() * s) + 1 }
function fmtLog(t: string) {
  return t
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>')
}

const defaultG = (): G => ({
  char: null, hp: 0, hpMax: 0, inv: [], conds: [], notes: '', gold: 0,
  history: [], spUsed: {}, dSucc: 0, dFail: 0,
  pendRoll: null, rollsDone: [], rollCnt: 0,
  inCombat: false, combatRound: 1, initiative: [], currentTurn: 0,
  battleMap: null, awaitingReaction: false, gameEnded: false, causeOfDeath: '',
  tokens: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, calls: 0 },
})

// ─── Save/Load API helpers ───────────────────────────────────────────────────

interface SlotData { cid: string; charName?: string; s: Omit<G, 'char' | 'pendRoll' | 'rollsDone' | 'rollCnt' | 'awaitingReaction' | 'gameEnded' | 'causeOfDeath' | 'tokens'>; log: LogMsg[]; at: string; t: number }

async function apiSave(slot: number, cid: string, g: G, log: LogMsg[]) {
  const body: SlotData = { cid, s: { hp: g.hp, hpMax: g.hpMax, inv: g.inv, conds: g.conds, notes: g.notes, gold: g.gold, history: g.history, spUsed: g.spUsed, dSucc: g.dSucc, dFail: g.dFail, inCombat: g.inCombat, combatRound: g.combatRound, initiative: g.initiative, currentTurn: g.currentTurn, battleMap: g.battleMap }, log, at: new Date().toLocaleString(), t: g.history.filter(m => m.role === 'user').length }
  await fetch('/api/saves', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slot, characterId: cid, state: body, logHtml: null, turnCount: body.t }) })
}

async function apiLoad(slot: number): Promise<{ data: SlotData } | null> {
  const res = await fetch(`/api/saves?slot=${slot}`)
  const json = await res.json()
  if (!json.saves || !json.saves[0]) return null
  const row = json.saves[0]
  return { data: { ...(row.state as SlotData), charName: row.characters?.name } }
}

async function apiDelete(slot: number) {
  await fetch(`/api/saves?slot=${slot}`, { method: 'DELETE' })
}

async function apiLoadAll(): Promise<{ slot: number; data: SlotData }[]> {
  const res = await fetch('/api/saves')
  const json = await res.json()
  if (!json.saves) return []
  return json.saves.map((s: { slot: number; state: SlotData; characters?: { name: string } }) => ({
    slot: s.slot,
    data: { ...s.state, charName: s.characters?.name },
  }))
}

async function fetchCharacter(id: string): Promise<Character | null> {
  const res = await fetch(`/api/characters/${id}`)
  if (!res.ok) return null
  const json = await res.json()
  return json.character || null
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function PlayPage() {
  return (
    <Suspense fallback={null}>
      <PlayPageInner />
    </Suspense>
  )
}

function PlayPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const lang = useLang()
  const dict = getDictionary(lang)
  const dp = dict.play

  const [phase, setPhase] = useState<Phase>('select')
  const [g, setG] = useState<G>(defaultG())
  const [log, setLog] = useState<LogMsg[]>([])
  const [msgCounter, setMsgCounter] = useState(0)
  const [inputText, setInputText] = useState('')
  const [loading, setLoading] = useState(false)
  const [showSheet, setShowSheet] = useState(false)
  const [showSaves, setShowSaves] = useState(false)
  const [showDrawer, setShowDrawer] = useState(false)
  const [showTokenDetail, setShowTokenDetail] = useState(false)
  const [allSaves, setAllSaves] = useState<{ slot: number; data: SlotData }[]>([])
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null)
  const [cbCollapsed, setCbCollapsed] = useState(false)
  const [mapVisible, setMapVisible] = useState(true)
  const [showManualNext, setShowManualNext] = useState<InitiativeEntry | null>(null)
  const [inlineError, setInlineError] = useState<string | null>(null)

  const gRef = useRef(g)
  const logRef = useRef(log)
  const msgCntRef = useRef(msgCounter)
  const loadingRef = useRef(loading)
  const logEl = useRef<HTMLDivElement>(null)

  useEffect(() => { gRef.current = g }, [g])
  useEffect(() => { logRef.current = log }, [log])
  useEffect(() => { msgCntRef.current = msgCounter }, [msgCounter])
  useEffect(() => { loadingRef.current = loading }, [loading])

  useEffect(() => { if (logEl.current) logEl.current.scrollTop = logEl.current.scrollHeight }, [log, loading, inlineError])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    if (phase === 'select') { apiLoadAll().then(setAllSaves).catch(() => {}) }
  }, [phase])

  const charId = searchParams.get('charId')
  const initializing = !!charId && phase === 'select'
  const charIdHandledRef = useRef<string | null>(null)

  // ── helpers ──────────────────────────────────────────────────────────────

  const showToast = (msg: string, err?: boolean) => setToast({ msg, err })

  const nextId = () => { const id = msgCntRef.current + 1; setMsgCounter(id); return id }

  const addMsg = useCallback((type: LogMsg['type'], text: string, cls?: string) => {
    const msg: LogMsg = { id: nextId(), type, text, cls }
    setLog(prev => [...prev, msg])
  }, [])

  const updateG = (updater: (prev: G) => G) => {
    setG(prev => { const next = updater(prev); gRef.current = next; return next })
  }

  // ── Combat ────────────────────────────────────────────────────────────────

  function startCombat(enemies: { name: string; dexMod?: number; init?: number; ref?: string; isAlly?: boolean }[], battleMap: BattleMap | null, opts: { playerSurprised?: boolean; surprisedRefs?: string[] }) {
    const playerSurprised = !!opts.playerSurprised
    const surprisedRefs = opts.surprisedRefs || []

    function rollInit(mod: number, surprised: boolean) {
      if (surprised) {
        const d1 = rRaw(20), d2 = rRaw(20), lo = Math.min(d1, d2)
        return { result: lo + mod, detail: `d20[${d1},${d2}→${lo} ${dp.rollBanner.disadvantage.toUpperCase()}]${mod >= 0 ? '+' : ''}${mod}=${lo + mod}` }
      }
      const d = rRaw(20)
      return { result: d + mod, detail: `d20[${d}]${mod >= 0 ? '+' : ''}${mod}=${d + mod}` }
    }

    updateG(prev => {
      const c = prev.char!
      const initiative: InitiativeEntry[] = []
      const playerMod = mS(c.dex).startsWith('+') ? parseInt(mS(c.dex)) : parseInt(mS(c.dex))
      const pr = rollInit(playerMod, playerSurprised)
      initiative.push({ name: c.name, init: pr.result, isPlayer: true, isAlly: false, alive: true, ref: 'player', surprised: playerSurprised })
      addMsg('roll', `${dict.newGame.review.initiative} ${c.name}${playerSurprised ? ` (${dp.rollBanner.disadvantage})` : ''} : ${pr.detail}`)

      enemies.forEach(e => {
        const dexMod = typeof e.dexMod === 'number' ? e.dexMod : 0
        const enemySurprised = surprisedRefs.indexOf(e.ref || '') !== -1 || surprisedRefs.indexOf(e.name) !== -1
        let enemyInit: number
        if (typeof e.dexMod === 'number') {
          const er = rollInit(dexMod, enemySurprised)
          enemyInit = er.result
          addMsg('roll', `${dict.newGame.review.initiative} ${e.name}${e.isAlly ? ` (${dp.combatMsgs.allySuffix.trim()})` : ''}${enemySurprised ? ` (${dp.rollBanner.disadvantage})` : ''} : ${er.detail}`)
        } else {
          enemyInit = e.init || 10
          addMsg('roll', `${dict.newGame.review.initiative} ${e.name} : ${enemyInit}`)
        }
        initiative.push({ name: e.name, init: enemyInit, isPlayer: false, isAlly: !!e.isAlly, alive: true, ref: e.ref || e.name, surprised: enemySurprised })
      })

      initiative.sort((a, b) => b.init !== a.init ? b.init - a.init : a.isPlayer ? 1 : -1)

      addMsg('sys', '═══════════════════════')
      addMsg('cbt', dp.combatMsgs.engaged)
      addMsg('sys', '═══════════════════════')
      const order = initiative.map(t => `${t.name}(${t.init})`).join(' → ')
      addMsg('cbt', fmt(dp.combatMsgs.order, { order }))

      const first = initiative[0]
      if (first?.isPlayer) addMsg('cbt', dp.combatMsgs.playerFirst)
      else if (first?.isAlly) { addMsg('cbt', fmt(dp.combatMsgs.allyFirst, { name: first.name })); setShowManualNext(first) }
      else { addMsg('cbt', fmt(dp.combatMsgs.enemyFirst, { name: first?.name || '' })); setShowManualNext(first) }

      return {
        ...prev,
        inCombat: true, combatRound: 1, initiative, currentTurn: 0,
        battleMap: battleMap || null,
      }
    })
  }

  function endCombat() {
    updateG(prev => ({ ...prev, inCombat: false, initiative: [], battleMap: null }))
    setShowManualNext(null)
    addMsg('cbt', dp.combatMsgs.ended)
  }

  function killEnemy(name: string) {
    updateG(prev => ({ ...prev, initiative: prev.initiative.map(t => t.name === name ? { ...t, alive: false, dead: true } : t) }))
  }
  function markDowned(name: string) {
    updateG(prev => ({ ...prev, initiative: prev.initiative.map(t => t.name === name ? { ...t, downed: true } : t) }))
  }
  function markStabilized(name: string) {
    updateG(prev => ({ ...prev, initiative: prev.initiative.map(t => t.name === name ? { ...t, stabilized: true, downed: false } : t) }))
  }
  function revive(name: string) {
    updateG(prev => ({ ...prev, initiative: prev.initiative.map(t => t.name === name ? { ...t, downed: false, stabilized: false, alive: true } : t) }))
  }
  function updateBattleMap(battleMap: BattleMap | null) {
    updateG(prev => ({ ...prev, battleMap }))
  }

  function nextTurn() {
    updateG(prev => {
      if (!prev.inCombat || prev.initiative.length === 0) return prev
      let next = (prev.currentTurn + 1) % prev.initiative.length
      let loops = 0
      while (loops < prev.initiative.length) {
        const t = prev.initiative[next]
        if (t.alive && !t.downed && !t.stabilized) break
        next = (next + 1) % prev.initiative.length
        loops++
      }
      let combatRound = prev.combatRound
      if (next <= prev.currentTurn) combatRound++
      const curr = prev.initiative[next]
      if (curr) {
        if (curr.isPlayer) {
          setShowManualNext(null)
          addMsg('cbt', fmt(dp.combatMsgs.yourTurn, { round: combatRound }))
          if (prev.hp <= 0 && prev.conds.includes('down')) {
            setTimeout(() => {
              addMsg('cbt', dp.combatMsgs.deathSaveRequired)
              requestRoll({ dice: 20, mod: 0, modLabel: '', type: 'death', label: dp.combatMsgs.deathSaveRequired, dc: 10, advantage: null })
            }, 50)
          }
        } else {
          addMsg('cbt', fmt(dp.combatMsgs.turnOf, { name: curr.name, ally: curr.isAlly ? dp.combatMsgs.allySuffix : '' }))
          setShowManualNext(curr)
        }
      }
      return { ...prev, currentTurn: next, combatRound }
    })
  }

  function playAutoTurn() {
    const curr = gRef.current.initiative[gRef.current.currentTurn]
    if (!curr) return
    setShowManualNext(null)
    const prefix = curr.isAlly ? dp.autoTurnAlly : dp.autoTurnEnemy
    callDM(`${prefix} ${fmt(dp.autoTurnPlaying, { name: curr.name })}`, false)
  }

  // ── Roll engine ───────────────────────────────────────────────────────────

  function requestRoll(rd: PendingRoll) {
    updateG(prev => ({ ...prev, pendRoll: rd, rollsDone: [], rollCnt: rd.advantage ? 2 : 1 }))
  }

  function rDie(sides: number) {
    const cur = gRef.current
    if (!cur.pendRoll) return
    const r = rRaw(sides)
    const newRolls = [...cur.rollsDone, r]

    if (newRolls.length < cur.rollCnt) {
      updateG(prev => ({ ...prev, rollsDone: newRolls }))
      addMsg('roll', `d${sides} → ${r}`)
      return
    }

    const p = cur.pendRoll
    let fr = r
    if (p.advantage === 'advantage') fr = Math.max(...newRolls)
    if (p.advantage === 'disadvantage') fr = Math.min(...newRolls)
    const total = fr + p.mod
    const isCrit = sides === 20 && fr === 20
    const isFmbl = sides === 20 && fr === 1
    const succ = p.dc != null ? total >= p.dc : null
    let cls = ''
    if (isCrit) cls = 'crit'; else if (isFmbl) cls = 'fmbl'; else if (succ === true) cls = 'ok'; else if (succ === false) cls = 'fail'
    const rs = newRolls.length > 1 ? `[${newRolls.join(',')}]→${fr}` : `→${fr}`
    const dcLabel = p.dc != null ? (succ ? ' ✓' : ' ✗') + ` ${fmt(dp.rollBanner.dc, { dc: p.dc })}` : ''
    const prefix = isCrit ? 'CRIT! ' : isFmbl ? 'FUMBLE! ' : ''
    const modPart = p.mod !== 0 ? `${p.mod > 0 ? '+' : ''}${p.mod}=${total}` : ''
    addMsg('roll', `${prefix}d${sides} ${rs}${modPart}${dcLabel}`, cls)

    if (p.type === 'death') {
      if (fr === 20) {
        updateG(prev => {
          const conds = prev.conds.filter(x => x !== 'down')
          return { ...prev, hp: 1, dSucc: 0, dFail: 0, conds, pendRoll: null, rollsDone: [] }
        })
        addMsg('cbt', dp.combatMsgs.natural20)
        if (gRef.current.inCombat) setTimeout(nextTurn, 50)
        return
      }
      const updatedSucc = isFmbl ? cur.dSucc : (succ ? cur.dSucc + 1 : cur.dSucc)
      const updatedFail = isFmbl ? cur.dFail + 2 : (succ ? cur.dFail : cur.dFail + 1)
      addMsg('cbt', fmt(dp.combatMsgs.stabilization, { s: updatedSucc, f: updatedFail }))
      if (updatedSucc >= 3) {
        addMsg('sys', dp.combatMsgs.stabilized)
        updateG(prev => ({ ...prev, dSucc: 0, dFail: 0, pendRoll: null, rollsDone: [] }))
        if (gRef.current.inCombat) setTimeout(nextTurn, 50)
        return
      }
      if (updatedFail >= 3) {
        const companions = cur.initiative.filter(t => t.isAlly)
        const anyCompanionUp = companions.some(t => t.alive && !t.downed && !t.dead)
        if (anyCompanionUp) {
          updateG(prev => ({
            ...prev,
            dSucc: 0, dFail: 0, pendRoll: null, rollsDone: [],
            conds: [...prev.conds.filter(x => x !== 'down'), 'dead'],
            initiative: prev.initiative.map(t => t.ref === 'player' ? { ...t, alive: false, dead: true } : t),
          }))
          addMsg('cbt', fmt(dp.combatMsgs.playerDiedCompanionContinues, { name: cur.char?.name || '', ally: companions.map(c => c.name).join(', ') }))
          if (gRef.current.inCombat) setTimeout(nextTurn, 50)
        } else {
          gameOver(dp.combatMsgs.causeThreeFailures)
        }
        return
      }
      updateG(prev => ({ ...prev, dSucc: updatedSucc, dFail: updatedFail, pendRoll: null, rollsDone: [] }))
      if (gRef.current.inCombat) {
        addMsg('sys', dp.combatMsgs.stayAt0)
        setTimeout(nextTurn, 50)
      } else {
        setTimeout(() => requestRoll({ dice: 20, mod: 0, modLabel: '', type: 'death', label: dp.combatMsgs.deathSaveRequired, dc: 10, advantage: null }), 50)
      }
      return
    }

    const done = { label: p.label, dice: p.dice, mod: p.mod, fr, total, succ, isCrit, isFmbl, advantage: p.advantage, dc: p.dc, rolls: newRolls }
    updateG(prev => ({ ...prev, pendRoll: null, rollsDone: [] }))
    const rm = buildRM(done, newRolls)
    setTimeout(() => callDM(rm, true), 50)
  }

  function buildRM(r: { label: string; dice: number; mod: number; fr: number; total: number; succ: boolean | null; isCrit: boolean; isFmbl: boolean; advantage: string | null; dc: number | null }, rolls: number[]) {
    let m = `[RESULT] ${r.label}: d${r.dice}`
    if (rolls.length > 1) m += ` [${rolls.join(',')}]->${r.fr}`
    else m += `->${r.fr}`
    if (r.mod !== 0) m += ` ${r.mod >= 0 ? '+' : ''}${r.mod}=${r.total}`
    if (r.dc != null) m += ` vs DC${r.dc} -> ${r.succ ? 'SUCCESS' : 'FAILURE'}`
    if (r.isCrit) m += ' [CRITICAL]'
    if (r.isFmbl) m += ' [FUMBLE]'
    if (r.advantage) m += ` [${r.advantage}]`
    return m
  }

  // ── API call ──────────────────────────────────────────────────────────────

  function buildBeginMessage(character: Character): string {
    const campaign = CAMPAIGNS.find(c => c.id === character.campaign)
    return fmt(dp.begin.instruction, {
      name: character.name,
      campaign: campaign ? campaign.name[lang] : '',
      blurb: campaign ? campaign.description[lang] : '',
    })
  }

  async function callDM(msg: string, isRoll: boolean, overrideG?: G) {
    const cur = overrideG || gRef.current
    if (cur.gameEnded) return

    const content = msg === 'BEGIN' ? buildBeginMessage(cur.char!) : msg

    const newHistory = [...cur.history, { role: 'user' as const, content }]
    updateG(prev => ({ ...prev, history: newHistory }))
    setLoading(true)

    const dynamicState: DynamicStateForAPI = {
      hp: cur.hp, hpMax: cur.hpMax, spUsed: cur.spUsed, conds: cur.conds,
      inv: cur.inv, gold: cur.gold, notes: cur.notes, inCombat: cur.inCombat,
      combatRound: cur.combatRound, initiative: cur.initiative, currentTurn: cur.currentTurn,
    }

    try {
      const res = await fetch('/api/game/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newHistory, characterId: cur.char!.id, dynamicState, lang }),
      })

      if (!res.ok) {
        const text = await res.text()
        let detail = text
        try { const j = JSON.parse(text); if (j.error) detail = j.error } catch {}
        throw new Error(`HTTP ${res.status} — ${detail.substring(0, 200)}`)
      }

      const data = await res.json()
      const raw: string = data.content || '*...*'
      let clean = raw

      if (data.usage) {
        const u = data.usage
        updateG(prev => ({
          ...prev,
          tokens: {
            input: prev.tokens.input + (u.input_tokens || 0),
            output: prev.tokens.output + (u.output_tokens || 0),
            cacheCreate: prev.tokens.cacheCreate + (u.cache_creation_input_tokens || 0),
            cacheRead: prev.tokens.cacheRead + (u.cache_read_input_tokens || 0),
            calls: prev.tokens.calls + 1,
          },
        }))
      }

      const reactionBlocks = extractAllBlocks(clean, 'REACTION')
      reactionBlocks.forEach(rb => {
        const parsed = safeParseJSON(rb)
        if (!parsed?.REACTION) return
        clean = clean.replace(rb, '')
        updateG(prev => ({ ...prev, awaitingReaction: true }))
        const rd = parsed.REACTION as { prompt?: string }
        addMsg('cbt', fmt(dp.combatMsgs.reactionPossible, { prompt: rd.prompt || '' }))
      })

      const combatBlocks = extractAllBlocks(clean, 'COMBAT')
      combatBlocks.forEach(cb => {
        const parsed = safeParseJSON(cb)
        if (!parsed?.COMBAT) return
        clean = clean.replace(cb, '')
        const cdata = parsed.COMBAT as {
          start?: boolean; enemies?: { name: string; dexMod?: number; ref?: string; isAlly?: boolean }[]
          battle_map?: BattleMap | null; playerSurprised?: boolean; surprisedRefs?: string[]
          kill?: string; downed?: string; stabilized?: string; revive?: string
          end?: boolean
        }
        if (cdata.start) {
          startCombat(cdata.enemies || [], cdata.battle_map || null, { playerSurprised: cdata.playerSurprised, surprisedRefs: cdata.surprisedRefs })
        } else if (cdata.battle_map !== undefined) {
          updateBattleMap(cdata.battle_map)
        }
        if (cdata.kill) { killEnemy(cdata.kill); addMsg('cbt', fmt(dp.combatMsgs.enemyDied, { name: cdata.kill })) }
        if (cdata.downed) { markDowned(cdata.downed); addMsg('cbt', fmt(dp.combatMsgs.allyDowned, { name: cdata.downed })) }
        if (cdata.stabilized) { markStabilized(cdata.stabilized); addMsg('cbt', fmt(dp.combatMsgs.allyStabilized, { name: cdata.stabilized })) }
        if (cdata.revive) { revive(cdata.revive); addMsg('cbt', fmt(dp.combatMsgs.allyRevived, { name: cdata.revive })) }
        if (cdata.end) endCombat()
      })

      const turnBlocks = extractAllBlocks(clean, 'TURN')
      turnBlocks.forEach(tb => {
        clean = clean.replace(tb, '')
        if (gRef.current.inCombat) setTimeout(nextTurn, 50)
      })

      const rm = clean.match(/\{"ROLL":\{[^}]+\}\}/)
      if (rm) {
        const rparsed = safeParseJSON(rm[0])
        if (rparsed?.ROLL) {
          const rd = rparsed.ROLL as PendingRoll
          clean = clean.replace(rm[0], '').trim()
          if (clean) addMsg('dm', clean)
          updateG(prev => ({ ...prev, history: [...prev.history, { role: 'assistant', content: raw }] }))
          autoSave()
          requestRoll(rd)
          setLoading(false)
          return
        }
      }

      const stateBlocks = extractAllBlocks(clean, 'STATE')
      stateBlocks.forEach(s => {
        const parsed = safeParseJSON(s)
        if (!parsed?.STATE) return
        const u = parsed.STATE as {
          hp?: number; addItem?: string; removeItem?: string; addCond?: string; removeCond?: string
          useSlot?: number; goldDelta?: number; gold?: number; note?: string
        }
        clean = clean.replace(s, '')
        updateG(prev => {
          const next = { ...prev }
          if (u.hp !== undefined) {
            const oldHp = next.hp
            next.hp = Math.max(0, Math.min(next.hpMax, u.hp))
            if (oldHp <= 0 && next.hp > 0) {
              next.conds = next.conds.filter(x => x !== 'down')
              next.dSucc = 0; next.dFail = 0
              addMsg('cbt', fmt(dp.combatMsgs.regainConscious, { hp: next.hp }))
            }
          }
          if (u.addItem) { next.inv = [...next.inv, u.addItem]; addMsg('sys', fmt(dp.combatMsgs.itemGain, { item: u.addItem })) }
          if (u.removeItem) { next.inv = next.inv.filter(i => i !== u.removeItem); addMsg('sys', fmt(dp.combatMsgs.itemLoss, { item: u.removeItem })) }
          if (u.addCond && !next.conds.includes(u.addCond)) next.conds = [...next.conds, u.addCond]
          if (u.removeCond) next.conds = next.conds.filter(x => x !== u.removeCond)
          if (u.useSlot != null) {
            const lv = u.useSlot
            const total = (next.char?.spell_slots?.[lv]) || 0
            const used = next.spUsed[lv] || 0
            if (used >= total) addMsg('sys', fmt(dp.combatMsgs.slotError, { lv, used, total }))
            else { next.spUsed = { ...next.spUsed, [lv]: used + 1 }; addMsg('sys', fmt(dp.combatMsgs.slotUsed, { lv, used: used + 1, total })) }
          }
          if (u.note) { next.notes = next.notes ? next.notes + '\n· ' + u.note : '· ' + u.note }
          if (typeof u.gold === 'number') { next.gold = Math.max(0, u.gold); addMsg('sys', fmt(dp.combatMsgs.purse, { gold: next.gold })) }
          if (typeof u.goldDelta === 'number') {
            next.gold = Math.max(0, next.gold + u.goldDelta)
            addMsg('sys', fmt(dp.combatMsgs.goldDelta, { sign: u.goldDelta >= 0 ? '+' : '', delta: u.goldDelta, gold: next.gold }))
          }
          return next
        })
      })

      const trimmed = clean.trim()
      if (trimmed) addMsg('dm', trimmed)

      updateG(prev => ({ ...prev, history: [...prev.history, { role: 'assistant', content: raw }] }))
      autoSave()

      const hasMarker = /\{"(ROLL|STATE|COMBAT|TURN|REACTION)":/.test(raw)
      const refusalKeywords = /i cannot|i can't|i won't|i'm not comfortable|as an ai|i'd rather|je ne peux pas|je préfère|en tant qu'ia/i
      const looksLikeRefusal = !hasMarker && refusalKeywords.test(trimmed) && trimmed.length < 600
      if (looksLikeRefusal) {
        addMsg('sys', dp.combatMsgs.dmRefused)
        addMsg('cbt', dp.combatMsgs.dmRefusedTip)
        const curG = gRef.current
        if (curG.inCombat && !curG.gameEnded) {
          const curr = curG.initiative[curG.currentTurn]
          if (curr && !curr.isPlayer) setTimeout(() => { if (gRef.current.inCombat && !gRef.current.pendRoll) { addMsg('sys', dp.combatMsgs.turnAutoSkipped); nextTurn() } }, 2000)
        }
      }

      const curG = gRef.current
      if (curG.hp <= 0 && !curG.conds.includes('dead') && !curG.conds.includes('down')) {
        updateG(prev => ({ ...prev, dSucc: 0, dFail: 0, conds: [...prev.conds, 'down'] }))
        if (curG.inCombat) {
          addMsg('cbt', dp.combatMsgs.fallUnconscious)
          const cur = curG.initiative[curG.currentTurn]
          if (cur?.isPlayer) setTimeout(nextTurn, 50)
        } else {
          addMsg('cbt', dp.combatMsgs.unconsciousOutOfCombat)
          setTimeout(() => requestRoll({ dice: 20, mod: 0, modLabel: '', type: 'death', label: dp.combatMsgs.deathSaveRequired, dc: 10, advantage: null }), 50)
        }
      }
    } catch (e) {
      const msg = (e as Error).message || 'unknown'
      addMsg('sys', fmt(dp.errors.api, { msg }))
      setInlineError(dp.errors.tryAgain)
      if (/500|502|503|529/.test(msg)) {
        addMsg('sys', dp.errors.transient)
        updateG(prev => {
          const h = [...prev.history]
          if (h.length > 0 && h[h.length - 1].role === 'user') h.pop()
          return { ...prev, history: h }
        })
      } else if (/429/.test(msg)) {
        addMsg('sys', dp.errors.rateLimit)
        updateG(prev => {
          const h = [...prev.history]
          if (h.length > 0 && h[h.length - 1].role === 'user') h.pop()
          return { ...prev, history: h }
        })
      }
    } finally {
      setLoading(false)
    }
  }

  // ── Game start ────────────────────────────────────────────────────────────

  function startGame(character: Character) {
    const startGold = character.equipment.filter(i => i.name === 'Gold Pieces').reduce((acc, i) => acc + i.quantity, 0)
    const inv = character.equipment
      .filter(i => i.name !== 'Gold Pieces')
      .map(i => `${i.quantity > 1 ? `${i.quantity}x ` : ''}${i.name}${i.notes ? ` (${i.notes})` : ''}`)
    const spUsed: Record<number, number> = {}
    if (character.spell_slots) Object.keys(character.spell_slots).forEach(lv => { spUsed[Number(lv)] = 0 })

    const fresh = defaultG()
    fresh.char = character
    fresh.hp = character.hp_max; fresh.hpMax = character.hp_max
    fresh.inv = inv; fresh.gold = startGold
    fresh.spUsed = spUsed
    setG(fresh); gRef.current = fresh
    setLog([]); setPhase('play')
    setTimeout(() => callDM('BEGIN', false, fresh), 50)
  }

  // fresh character coming from the wizard
  useEffect(() => {
    if (!charId || charIdHandledRef.current === charId) return
    charIdHandledRef.current = charId
    fetchCharacter(charId).then(character => {
      if (character) startGame(character)
      else showToast(fmt(dp.toast.charNotFound, { id: charId }), true)
      router.replace(`/${lang}/play`)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charId])

  // ── Send message ──────────────────────────────────────────────────────────

  function sendMsg() {
    const cur = gRef.current
    if (cur.pendRoll) { addMsg('sys', dp.combatMsgs.rollFirst); return }
    const text = inputText.trim()
    if (!text) return
    setInputText('')
    setInlineError(null)
    if (cur.awaitingReaction) {
      updateG(prev => ({ ...prev, awaitingReaction: false }))
      addMsg('pl', text)
      callDM(`${dp.reactionResponse} ${text} — ${dp.reactionContinue}`, false)
      return
    }
    addMsg('pl', text)
    autoSave()
    callDM(text, false)
  }

  // ── Battle map interaction ───────────────────────────────────────────────

  function handleMapMove(x: number, y: number) {
    const cols = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const posLabel = `${cols[x] ?? x}${y + 1}`
    setInputText(fmt(dp.battleMap.moveTo, { pos: posLabel }))
    setTimeout(sendMsg, 0)
  }

  function handleTargetEnemy(token: MapToken) {
    setInputText(fmt(dp.battleMap.attackTarget, { label: token.label }))
  }

  // ── Save / Load ───────────────────────────────────────────────────────────

  const autoSave = useCallback(() => {
    const cur = gRef.current
    if (!cur.char) return
    apiSave(0, cur.char.id, cur, logRef.current).catch(() => {})
  }, [])

  async function saveGame(slot: number) {
    const cur = gRef.current
    if (!cur.char) { showToast(dp.toast.noGame, true); return }
    try {
      await apiSave(slot, cur.char.id, cur, logRef.current)
      showToast(fmt(dp.toast.saveOk, { slot }))
      const updated = await apiLoadAll()
      setAllSaves(updated)
    } catch (e) {
      showToast(fmt(dp.toast.error, { msg: (e as Error).message.substring(0, 50) }), true)
    }
  }

  async function loadGame(slot: number) {
    try {
      const result = await apiLoad(slot)
      if (!result) { showToast(fmt(dp.toast.slotEmpty, { slot }), true); return }
      const d = result.data
      const ch = await fetchCharacter(d.cid)
      if (!ch) { showToast(fmt(dp.toast.charNotFound, { id: d.cid }), true); return }
      const restored = defaultG()
      restored.char = ch; restored.hp = d.s.hp; restored.hpMax = d.s.hpMax
      restored.inv = d.s.inv || []; restored.conds = d.s.conds || []
      restored.notes = d.s.notes || ''; restored.history = d.s.history || []
      restored.spUsed = d.s.spUsed || {}
      restored.gold = typeof d.s.gold === 'number' ? d.s.gold : 0
      restored.inCombat = d.s.inCombat || false
      restored.combatRound = d.s.combatRound || 1
      restored.initiative = d.s.initiative || []
      restored.currentTurn = d.s.currentTurn || 0
      restored.battleMap = d.s.battleMap || null
      setG(restored); gRef.current = restored
      setLog(d.log || [])
      setPhase('play')
      setShowSaves(false)
      showToast(fmt(dp.toast.slotLoaded, { slot, name: ch.name }))
    } catch (e) {
      showToast(fmt(dp.toast.loadError, { msg: (e as Error).message.substring(0, 50) }), true)
    }
  }

  async function delGame(slot: number) {
    await apiDelete(slot)
    showToast(dp.toast.deleted)
    const updated = await apiLoadAll()
    setAllSaves(updated)
  }

  // ── Game over ─────────────────────────────────────────────────────────────

  function gameOver(cause?: string) {
    updateG(prev => ({ ...prev, gameEnded: true, causeOfDeath: cause || dp.gameOverScreen.causeGeneric }))
    addMsg('cbt', dp.combatMsgs.death)
    addMsg('sys', dp.combatMsgs.gameOver)
  }

  async function abandonGame() {
    updateG(defaultG); setLog([]); setPhase('select')
    await apiDelete(0)
  }

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push(`/${lang}/login`)
  }

  function tokenLabel(t: TokenUsage) {
    const total = t.input + t.output + t.cacheCreate + t.cacheRead
    if (total === 0) return '🪙 0'
    const k = Math.round(total / 100) / 10
    return `🪙 ${k}k`
  }

  function isInputLockedFor(cur: G): boolean {
    if (loading) return true
    if (cur.pendRoll) return true
    if (cur.gameEnded) return true
    return false
  }

  // ── CSS ───────────────────────────────────────────────────────────────────

  const S: Record<string, React.CSSProperties> = {
    app: { display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', fontFamily: "'Crimson Pro', serif", color: '#f0ead8', background: '#0f0d09' },
    hdr: { background: '#1e1912', borderBottom: '2px solid #c9952a', padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 },
    ht: { fontFamily: "'Cinzel Decorative', cursive", fontSize: 'clamp(10px,3.5vw,16px)', color: '#c9952a', lineHeight: 1.2 },
    hs: { fontFamily: "'Cinzel', serif", fontSize: '7px', letterSpacing: '2px', color: '#b8a878', textTransform: 'uppercase' },
    hbdg: { fontFamily: "'Cinzel', serif", fontSize: '8px', letterSpacing: '2px', color: '#c8392b', border: '1px solid #c8392b', padding: '2px 7px', whiteSpace: 'nowrap' },
    hbtn: { fontFamily: "'Cinzel', serif", fontSize: '9px', letterSpacing: '1px', padding: '5px 9px', background: 'transparent', border: '1px solid #3a3020', color: '#b8a878', cursor: 'pointer', borderRadius: '2px' },
  }

  // ── Render: select screen ─────────────────────────────────────────────────

  if (phase === 'select') {
    return (
      <div style={S.app}>
        <div style={S.hdr}>
          <div><div style={S.ht}>{dict.common.appName}</div><div style={S.hs}>{dict.common.tagline}</div></div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <span style={S.hbdg}>{dp.header.badge}</span>
            <button onClick={signOut} style={{ ...S.hbtn, fontSize: '8px' }}>⏏ {dict.common.signOut}</button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '14px' }}>
          {initializing && <div style={{ textAlign: 'center', color: '#7a6840', padding: '20px' }}>{dict.common.loading}</div>}

          {allSaves.filter(s => s.slot !== 0).length > 0 && (
            <>
              <div style={{ fontFamily: "'Cinzel', serif", fontSize: '8px', letterSpacing: '3px', color: '#e8d090', textTransform: 'uppercase', marginBottom: '5px', textAlign: 'center' }}>{dp.select.resumeTitle}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px', paddingBottom: '14px', borderBottom: '1px solid #3a3020' }}>
                {allSaves.filter(s => s.slot !== 0).map(s => (
                  <div key={s.slot} onClick={() => loadGame(s.slot)} style={{ background: 'rgba(42,107,58,.1)', border: '1px solid #3d9954', padding: '9px 11px', cursor: 'pointer' }}>
                    <div style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', color: '#80e090', fontWeight: 600 }}>{fmt(dp.saves.slotChar, { slot: s.slot, name: s.data.charName || s.data.cid })}</div>
                    <div style={{ fontFamily: "'Cinzel', serif", fontSize: '8px', color: '#7a6840', letterSpacing: '1px', marginTop: '2px' }}>{fmt(dp.saves.turns, { at: s.data.at, t: s.data.t })}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div style={{ fontFamily: "'Cinzel Decorative', cursive", fontSize: '17px', color: '#c9952a', textAlign: 'center', marginBottom: '10px' }}>{dp.select.newGameTitle}</div>
          <div style={{ fontSize: '12px', color: '#b8a878', lineHeight: 1.6, border: '1px solid #3a3020', padding: '10px', background: 'rgba(255,255,255,.02)', marginBottom: '14px', fontStyle: 'italic', textAlign: 'center' }}>
            {dp.select.newGameDesc}
          </div>

          <button
            onClick={() => router.push(`/${lang}/new-game`)}
            style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase', padding: '14px', background: '#2a6b3a', border: '2px solid #3d9954', color: '#fff', cursor: 'pointer', width: '100%', fontWeight: 600 }}
          >
            {dp.select.newGameButton}
          </button>
        </div>
      </div>
    )
  }

  // ── Render: game over overlay ─────────────────────────────────────────────

  if (g.gameEnded) {
    return (
      <div style={{ ...S.app, alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '24px' }}>
        <div style={{ fontFamily: "'Cinzel', serif", fontSize: '9px', letterSpacing: '3px', color: '#c8392b', textTransform: 'uppercase', marginBottom: '18px' }}>{dp.gameOverScreen.title}</div>
        <div style={{ fontFamily: "'Cinzel Decorative', cursive", fontSize: '22px', color: '#c9952a', marginBottom: '10px' }}>{g.char?.name}</div>
        <div style={{ fontSize: '13px', color: '#b8a878', maxWidth: '360px', marginBottom: '28px', lineHeight: 1.6, fontStyle: 'italic' }}>{g.causeOfDeath || dp.gameOverScreen.causeGeneric}</div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
          <button onClick={() => loadGame(0)} style={{ fontFamily: "'Cinzel', serif", fontSize: '10px', letterSpacing: '1px', textTransform: 'uppercase', padding: '11px 16px', background: '#2a6b3a', border: '2px solid #3d9954', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
            {dp.gameOverScreen.loadLastSave}
          </button>
          <button onClick={() => router.push(`/${lang}`)} style={{ fontFamily: "'Cinzel', serif", fontSize: '10px', letterSpacing: '1px', textTransform: 'uppercase', padding: '11px 16px', background: 'transparent', border: '2px solid #3a3020', color: '#b8a878', cursor: 'pointer', fontWeight: 600 }}>
            {dp.gameOverScreen.mainMenu}
          </button>
        </div>
      </div>
    )
  }

  // ── Render: play screen ───────────────────────────────────────────────────

  const pendRoll = g.pendRoll
  const inputLocked = isInputLockedFor(g)
  const tokens = g.tokens
  const campaign = CAMPAIGNS.find(c => c.id === g.char?.campaign)

  return (
    <div style={S.app}>
      <div style={S.hdr}>
        <div><div style={S.ht}>{campaign ? campaign.name[lang] : dict.common.appName}</div><div style={S.hs}>{dict.common.tagline}</div></div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          {g.inCombat && <button onClick={() => setShowDrawer(true)} style={{ ...S.hbtn, background: 'rgba(155,35,24,.2)', borderColor: '#c8392b', color: '#ff9050', fontSize: '9px', fontWeight: 600 }}>{dp.header.combatButton}</button>}
          <span style={S.hbdg}>{fmt(dp.header.hpBadge, { hp: g.hp, hpMax: g.hpMax })}</span>
          <button onClick={() => setShowTokenDetail(true)} style={{ ...S.hbtn, fontSize: '8px' }}>{tokenLabel(tokens)}</button>
          <button onClick={() => { apiLoadAll().then(setAllSaves); setShowSaves(true) }} style={S.hbtn}>💾</button>
          <button onClick={abandonGame} style={{ ...S.hbtn, borderColor: '#c8392b', color: '#ff8070' }}>⏏</button>
        </div>
      </div>

      {pendRoll && (
        <div style={{ background: '#7a4f0a', borderBottom: '1px solid #c8820a', padding: '6px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: "'Cinzel', serif", fontSize: '8px', letterSpacing: '2px', color: '#ffcc70', textTransform: 'uppercase' }}>{dp.rollBanner.required}</div>
            <div style={{ fontSize: '11px', color: '#ffe090', fontWeight: 600 }}>{pendRoll.label}{pendRoll.dc ? ` · ${fmt(dp.rollBanner.dc, { dc: pendRoll.dc })}` : ''}</div>
          </div>
          <span style={{ fontFamily: "'Cinzel', serif", fontSize: '7px', padding: '2px 5px', borderRadius: '2px', color: '#fff', background: pendRoll.advantage === 'advantage' ? '#2a6b3a' : pendRoll.advantage === 'disadvantage' ? '#9b2318' : '#445' }}>
            {pendRoll.advantage === 'advantage' ? dp.rollBanner.advantage : pendRoll.advantage === 'disadvantage' ? dp.rollBanner.disadvantage : dp.rollBanner.normal}
          </span>
        </div>
      )}

      {g.inCombat && (
        <div style={{ background: '#1a1610', borderBottom: '1px solid #c8392b', flexShrink: 0 }}>
          <div onClick={() => setCbCollapsed(p => !p)} style={{ padding: '5px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
            <span style={{ fontFamily: "'Cinzel', serif", fontSize: '9px', letterSpacing: '2px', color: '#ff9050', textTransform: 'uppercase' }}>{dp.combat.label}</span>
            <span style={{ fontFamily: "'Cinzel', serif", fontSize: '8px', color: '#b8a878' }}>{fmt(dp.combat.round, { n: g.combatRound })} {cbCollapsed ? '▶' : '▼'}</span>
          </div>
          {!cbCollapsed && (
            <div style={{ overflowX: 'auto', paddingBottom: '6px' }}>
              <div style={{ display: 'flex', gap: '4px', padding: '0 8px', minWidth: 'max-content' }}>
                {g.initiative.map((t, i) => (
                  <div key={t.ref} style={{ fontFamily: "'Cinzel', serif", fontSize: '9px', padding: '4px 8px', borderRadius: '2px', border: `1px solid ${t.dead ? '#3a3020' : t.isPlayer || t.isAlly ? '#3d9954' : '#c8392b'}`, background: i === g.currentTurn ? 'rgba(201,149,42,.15)' : 'transparent', color: t.dead ? '#3a3020' : t.downed || t.stabilized ? '#7a4f0a' : t.isPlayer || t.isAlly ? '#80e090' : '#ff8070', textDecoration: t.dead ? 'line-through' : 'none', whiteSpace: 'nowrap' }}>
                    {i === g.currentTurn ? '▶ ' : ''}{t.name} ({t.init}){t.downed ? ' 🩸' : t.stabilized ? ' 💤' : ''}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {g.inCombat && g.battleMap && (
        <div style={{ background: '#0f0d09', borderBottom: '1px solid #3a3020', flexShrink: 0 }}>
          <div style={{ padding: '4px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', overflow: 'hidden' }}>
              <span style={{ fontFamily: "'Cinzel', serif", fontSize: '8px', letterSpacing: '2px', color: '#7a6840', textTransform: 'uppercase', flexShrink: 0 }}>{dp.battleMap.title}</span>
              {mapVisible && <TurnOrderTracker tokens={g.battleMap.tokens} />}
            </div>
            <button onClick={() => setMapVisible(v => !v)} style={{ fontFamily: "'Cinzel', serif", fontSize: '8px', letterSpacing: '1px', color: '#c9952a', background: 'transparent', border: 'none', cursor: 'pointer', flexShrink: 0, textDecoration: 'underline' }}>
              {mapVisible ? dp.battleMap.hide : dp.battleMap.show}
            </button>
          </div>
          {mapVisible && (
            <div style={{ padding: '4px 12px 8px', overflow: 'auto', maxHeight: '42vh' }}>
              <BattleMapCanvas
                battleMap={g.battleMap}
                playerSpeed={g.char?.speed ?? 30}
                isPlayerTurn={g.inCombat && g.initiative[g.currentTurn]?.isPlayer === true}
                onMove={handleMapMove}
                onTargetEnemy={handleTargetEnemy}
              />
            </div>
          )}
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ fontFamily: "'Cinzel', serif", fontSize: '7px', letterSpacing: '3px', textTransform: 'uppercase', color: '#7a6840', padding: '4px 12px', flexShrink: 0 }}>{dp.log.title}</div>
        <div ref={logEl} style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '6px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {log.map(msg => (
            <div key={msg.id} style={msgStyle(msg)}>
              {(msg.type === 'dm' || msg.type === 'pl') && (
                <span style={{ fontFamily: "'Cinzel', serif", fontSize: '7px', letterSpacing: '2px', textTransform: 'uppercase', color: msg.type === 'dm' ? '#7a6840' : '#2a6b3a', display: 'block', marginBottom: '2px' }}>
                  {msg.type === 'dm' ? dp.log.dmLabel : g.char?.name || ''}
                </span>
              )}
              <span dangerouslySetInnerHTML={{ __html: msg.type === 'dm' || msg.type === 'pl' || msg.type === 'cbt' ? fmtLog(msg.text) : msg.text }} />
            </div>
          ))}
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 0' }}>
              <span style={{ fontFamily: "'Cinzel', serif", fontSize: '9px', color: '#7a6840' }}>{dp.log.thinking}</span>
              <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#c9952a', animation: `pulse 1.2s ease-in-out ${i * 0.4}s infinite` }} />
                ))}
              </div>
            </div>
          )}
          {inlineError && !loading && (
            <div style={{ fontFamily: "'Cinzel', serif", fontSize: '10px', color: '#ff8070', padding: '6px 0', letterSpacing: '0.5px' }}>
              ⚠ {inlineError}
            </div>
          )}
        </div>
      </div>

      <button onClick={() => setShowSheet(true)} style={{ fontFamily: "'Cinzel', serif", fontSize: '10px', letterSpacing: '1px', padding: '8px', background: '#1a1610', border: 'none', borderTop: '1px solid #3a3020', color: '#b8a878', cursor: 'pointer', flexShrink: 0 }}>
        {dp.sheetButton}
      </button>

      {showManualNext && !loading && (
        <button onClick={playAutoTurn} style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase', padding: '11px', background: '#7a4f0a', border: 'none', borderTop: '1px solid #c8820a', borderBottom: '1px solid #c8820a', color: '#fff', cursor: 'pointer', width: '100%', fontWeight: 600, flexShrink: 0 }}>
          {fmt(dp.playTurnButton, { name: showManualNext.name })}
        </button>
      )}

      <div style={{ background: '#1a1610', borderTop: '1px solid #3a3020', padding: '8px 12px', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <div>
            <div style={{ fontFamily: "'Cinzel', serif", fontSize: '7px', letterSpacing: '2px', textTransform: 'uppercase', color: '#7a6840' }}>
              {dp.dice.label}{pendRoll ? ` — ${pendRoll.label}` : ''}
            </div>
            {pendRoll && <div style={{ fontSize: '10px', color: '#c9952a' }}>d{pendRoll.dice}{pendRoll.mod !== 0 ? (pendRoll.mod > 0 ? '+' : '') + pendRoll.mod : ''}{pendRoll.dc ? ` ${fmt(dp.rollBanner.dc, { dc: pendRoll.dc })}` : ''} ({pendRoll.modLabel})</div>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {[4, 6, 8, 10, 12, 20, 100].map(dd => {
            const isReq = pendRoll?.dice === dd
            return (
              <button key={dd} onClick={() => rDie(dd)} disabled={!isReq} style={{ flex: 1, fontFamily: "'Cinzel', serif", fontSize: '10px', padding: '7px 2px', background: '#1e1912', border: `1px solid ${isReq ? '#c9952a' : '#3a3020'}`, color: isReq ? '#c9952a' : '#3a3020', cursor: isReq ? 'pointer' : 'not-allowed', borderRadius: '2px', fontWeight: isReq ? 600 : 400 }}>
                {dd === 100 ? 'd%' : `d${dd}`}
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ background: '#1e1912', borderTop: '1px solid #3a3020', flexShrink: 0 }}>
        {pendRoll && (
          <div style={{ padding: '6px 12px', background: 'rgba(155,35,24,.1)', fontFamily: "'Cinzel', serif", fontSize: '9px', letterSpacing: '1px', color: '#ff8070', textAlign: 'center' }}>
            {dp.input.rollRequired}
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', padding: '6px 12px 4px' }}>
          {(['observe', 'talk', 'search', 'attack', 'shortRest', 'recap'] as const).map(key => (
            <button key={key} onClick={() => { if (!pendRoll) { setInputText(dp.quickActions[key]); setTimeout(sendMsg, 0) } }} disabled={!!pendRoll || inputLocked} style={{ fontFamily: "'Cinzel', serif", fontSize: '9px', padding: '4px 8px', background: '#241f17', border: '1px solid #3a3020', color: '#7a6840', cursor: 'pointer', borderRadius: '2px', opacity: (pendRoll || inputLocked) ? 0.4 : 1 }}>
              {dp.quickActionLabels[key]}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '8px', padding: '4px 12px 10px', alignItems: 'flex-end' }}>
          <textarea
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg() } }}
            placeholder={loading ? dp.input.loading : dp.input.placeholder}
            disabled={inputLocked}
            rows={2}
            style={{ flex: 1, fontFamily: "'Crimson Pro', serif", fontSize: '14px', padding: '9px 10px', background: inputLocked ? '#16130d' : '#241f17', border: '1px solid #3a3020', color: '#f0ead8', outline: 'none', resize: 'none', WebkitAppearance: 'none', opacity: inputLocked ? 0.5 : 1 }}
          />
          <button onClick={sendMsg} disabled={inputLocked || loading} style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', padding: '10px 14px', background: '#2a6b3a', border: '2px solid #3d9954', color: '#fff', cursor: (inputLocked || loading) ? 'not-allowed' : 'pointer', opacity: (inputLocked || loading) ? 0.4 : 1, alignSelf: 'stretch' }}>
            {dp.input.send}
          </button>
        </div>
      </div>

      {showSheet && <SheetModal g={g} lang={lang} dict={dict} onClose={() => setShowSheet(false)} />}
      {showSaves && (
        <SavesModal
          g={g} dict={dict} allSaves={allSaves}
          onLoad={loadGame} onSave={saveGame} onDelete={delGame}
          onClose={() => setShowSaves(false)}
        />
      )}

      {showDrawer && (
        <>
          <div onClick={() => setShowDrawer(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 149 }} />
          <div style={{ position: 'fixed', top: 0, right: 0, width: '88%', maxWidth: '380px', height: '100vh', background: '#1a1610', borderLeft: '2px solid #c8392b', zIndex: 150, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '10px 14px', background: '#1e1912', borderBottom: '2px solid #c8392b', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <span style={{ fontFamily: "'Cinzel Decorative', cursive", fontSize: '14px', color: '#ff9050' }}>{dp.combat.label}</span>
              <button onClick={() => setShowDrawer(false)} style={{ fontFamily: "'Cinzel', serif", fontSize: '10px', letterSpacing: '1px', padding: '5px 10px', background: 'transparent', border: '1px solid #7a6840', color: '#7a6840', cursor: 'pointer', borderRadius: '2px' }}>{dp.saves.close}</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
              <div style={{ fontFamily: "'Cinzel', serif", fontSize: '8px', letterSpacing: '2px', color: '#ff9050', textTransform: 'uppercase', marginBottom: '6px', borderBottom: '1px solid #3a3020', paddingBottom: '3px' }}>{fmt(dp.combat.round, { n: g.combatRound })}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '14px' }}>
                {g.initiative.map((t, i) => (
                  <div key={t.ref} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', background: i === g.currentTurn ? 'rgba(201,149,42,.1)' : 'transparent', border: `1px solid ${i === g.currentTurn ? '#c9952a' : '#3a3020'}` }}>
                    <span style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', color: '#7a6840', minWidth: '24px', textAlign: 'right' }}>{t.init}</span>
                    <span style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', color: t.dead ? '#3a3020' : t.isPlayer || t.isAlly ? '#80e090' : '#ff8070', textDecoration: t.dead ? 'line-through' : 'none' }}>
                      {i === g.currentTurn ? '▶ ' : ''}{t.name}{t.isAlly ? dp.combatMsgs.allySuffix : ''}{t.downed ? ' 🩸' : t.stabilized ? ' 💤' : ''}
                    </span>
                  </div>
                ))}
              </div>
              {g.battleMap && (
                <>
                  <div style={{ fontFamily: "'Cinzel', serif", fontSize: '8px', letterSpacing: '2px', color: '#ff9050', textTransform: 'uppercase', marginBottom: '6px', borderBottom: '1px solid #3a3020', paddingBottom: '3px' }}>{dp.battleMap.title}</div>
                  <div style={{ overflow: 'auto' }}>
                    <BattleMapCanvas
                      battleMap={g.battleMap}
                      playerSpeed={g.char?.speed ?? 30}
                      isPlayerTurn={g.inCombat && g.initiative[g.currentTurn]?.isPlayer === true}
                      onMove={handleMapMove}
                      onTargetEnemy={handleTargetEnemy}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {showTokenDetail && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }} onClick={() => setShowTokenDetail(false)}>
          <div style={{ background: '#1a1610', border: '1px solid #3a3020', padding: '16px', minWidth: '260px' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: "'Cinzel', serif", fontSize: '10px', letterSpacing: '2px', color: '#c9952a', textTransform: 'uppercase', marginBottom: '12px' }}>{dp.tokens.title}</div>
            {[
              [dp.tokens.calls, String(tokens.calls)],
              [dp.tokens.input, `${tokens.input.toLocaleString()} tk`],
              [dp.tokens.output, `${tokens.output.toLocaleString()} tk`],
              [dp.tokens.cacheCreate, `${tokens.cacheCreate.toLocaleString()} tk`],
              [dp.tokens.cacheRead, `${tokens.cacheRead.toLocaleString()} tk`],
            ].map(([l, v]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px' }}>
                <span style={{ color: '#7a6840' }}>{l}</span>
                <span style={{ color: '#f0ead8', fontFamily: "'JetBrains Mono', monospace", fontSize: '11px' }}>{v}</span>
              </div>
            ))}
            <button onClick={() => setShowTokenDetail(false)} style={{ width: '100%', marginTop: '8px', fontFamily: "'Cinzel', serif", fontSize: '10px', padding: '8px', background: 'transparent', border: '1px solid #3a3020', color: '#7a6840', cursor: 'pointer' }}>{dp.saves.close}</button>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: '16px', left: '50%', transform: 'translateX(-50%)', background: toast.err ? '#9b2318' : '#2a6b3a', color: '#fff', fontFamily: "'Cinzel', serif", fontSize: '9px', letterSpacing: '2px', textTransform: 'uppercase', padding: '8px 15px', border: `1px solid ${toast.err ? '#c8392b' : '#3d9954'}`, zIndex: 999, whiteSpace: 'nowrap' }}>
          {toast.msg}
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 60%, 100% { opacity: 0.2; } 30% { opacity: 1; } }
      `}</style>
    </div>
  )
}

// ─── Turn order tracker (from battle map tokens) ─────────────────────────

function TurnOrderTracker({ tokens }: { tokens: MapToken[] }) {
  return (
    <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
      {tokens.filter(t => t.condition !== 'defeated').map(t => (
        <div
          key={t.id}
          style={{
            fontFamily: "'Cinzel', serif", fontSize: '9px', fontWeight: 700, padding: '3px 7px', borderRadius: '2px',
            background: t.is_active ? '#c9952a' : '#241f17',
            color: t.is_active ? '#1a1610' : '#b8a878',
            border: `1px solid ${t.is_active ? '#c9952a' : '#3a3020'}`,
          }}
        >
          {t.label}
        </div>
      ))}
    </div>
  )
}

// ─── Character sheet modal ────────────────────────────────────────────────

function SheetModal({ g, lang, dict, onClose }: { g: G; lang: Lang; dict: Dictionary; onClose: () => void }) {
  const dp = dict.play
  const c = g.char; if (!c) return null
  const pct = Math.max(0, g.hp / g.hpMax * 100)
  const bc = pct > 50 ? '#2a6b3a' : pct > 25 ? '#c9952a' : '#9b2318'
  const styl = { fontFamily: "'Cinzel', serif", fontSize: '8px', letterSpacing: '2px', color: '#b8a878', textTransform: 'uppercase' as const, marginTop: '12px', marginBottom: '4px' }
  const speciesMap = getSpecies(lang) as Record<string, SpeciesData>
  const bgMap = getBackgrounds(lang) as Record<string, BackgroundData>
  const classMap = getClasses(lang) as Record<string, ClassData>
  const species = speciesMap[c.species]; const bg = bgMap[c.background]; const cls = classMap[c.class]
  const al = ABILITY_LABELS[lang]
  const abilityOrder: (keyof typeof al)[] = ['str', 'dex', 'con', 'int', 'wis', 'cha']

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 200, overflowY: 'auto', padding: '16px' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: '#1a1610', border: '1px solid #3a3020', maxWidth: '500px', margin: '0 auto', padding: '16px', position: 'relative' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: '8px', right: '8px', background: 'transparent', border: '1px solid #3a3020', color: '#7a6840', cursor: 'pointer', padding: '4px 8px', fontFamily: "'Cinzel', serif", fontSize: '9px' }}>{dp.sheet.close}</button>
        <div style={{ fontFamily: "'Cinzel Decorative', cursive", fontSize: '14px', color: '#c9952a', marginBottom: '2px' }}>{c.name}</div>
        <div style={{ fontFamily: "'Cinzel', serif", fontSize: '8px', color: '#c8392b', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '8px' }}>
          {species?.name}{c.subrace ? ` (${species?.subraces?.[c.subrace]?.name})` : ''} · {cls?.name} · {dict.newGame.review.level} {c.level}
        </div>
        <div style={{ fontSize: '10px', color: '#b8a878', background: 'rgba(255,255,255,0.02)', border: '1px solid #3a3020', padding: '6px', marginBottom: '8px' }}>
          {fmt(dp.sheet.background, { bg: bg?.name || c.background, desc: bg?.description || '' })}
        </div>

        <div style={styl}>{dp.sheet.abilityScores}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: '4px', marginBottom: '8px' }}>
          {abilityOrder.map(k => (
            <div key={k} style={{ background: '#241f17', border: '1px solid #3a3020', padding: '4px', textAlign: 'center' }}>
              <div style={{ fontFamily: "'Cinzel', serif", fontSize: '6px', color: '#7a6840' }}>{al[k]}</div>
              <div style={{ fontSize: '14px', fontWeight: 600 }}>{c[k]}</div>
              <div style={{ fontSize: '10px', color: '#c9952a' }}>{mS(c[k])}</div>
            </div>
          ))}
        </div>

        <div style={styl}>{dp.sheet.combatLine}</div>
        <div style={{ marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontFamily: "'Cinzel', serif", fontSize: '9px', color: '#7a6840' }}>{dp.sheet.hp}</span>
          <span style={{ fontSize: '14px', fontWeight: 600 }}>{g.hp} / {g.hpMax}</span>
        </div>
        <div style={{ height: '6px', background: '#241f17', border: '1px solid #3a3020', marginBottom: '8px' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: bc, transition: 'width 0.3s' }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '4px', marginBottom: '8px' }}>
          {[[dp.sheet.ac, String(c.ac)], [dp.sheet.init, mS(c.dex)], [dp.sheet.pb, '+2']].map(([l, v]) => (
            <div key={l} style={{ background: '#241f17', border: '1px solid #3a3020', padding: '6px', textAlign: 'center' }}>
              <div style={{ fontFamily: "'Cinzel', serif", fontSize: '6px', color: '#7a6840' }}>{l}</div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: l === dp.sheet.pb ? '#c9952a' : '#f0ead8' }}>{v}</div>
            </div>
          ))}
        </div>

        {g.conds.length > 0 && (<><div style={styl}>{dp.sheet.conditions}</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>{g.conds.map(cd => <span key={cd} style={{ background: 'rgba(155,35,24,0.2)', border: '1px solid #c8392b', color: '#ff8070', padding: '2px 6px', fontSize: '10px', fontFamily: "'Cinzel', serif" }}>{cd}</span>)}</div></>)}

        {(c.cantrips?.length || c.spells_known?.length) ? (
          <>
            {c.spell_slots && (
              <>
                <div style={styl}>{dp.sheet.spellSlots}</div>
                {Object.keys(c.spell_slots).map(lv => {
                  const tot = c.spell_slots![+lv]; const used = g.spUsed[+lv] || 0
                  return (
                    <div key={lv} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                      <span style={{ fontFamily: "'Cinzel', serif", fontSize: '8px', color: '#7a6840' }}>{fmt(dp.sheet.level, { lv })}</span>
                      {Array.from({ length: tot }).map((_, i) => <div key={i} style={{ width: '12px', height: '12px', borderRadius: '50%', background: i < used ? '#241f17' : '#c9952a', border: '1px solid #3a3020' }} />)}
                      <span style={{ fontFamily: "'Cinzel', serif", fontSize: '8px', color: '#7a6840' }}>{tot - used}/{tot}</span>
                    </div>
                  )
                })}
              </>
            )}
            {!!c.cantrips?.length && <><div style={styl}>{dp.sheet.cantrips}</div><ul style={{ paddingLeft: '16px', fontSize: '11px', color: '#b8a878', lineHeight: 1.7, marginBottom: '8px' }}>{c.cantrips.map(s => <li key={s}>{s}</li>)}</ul></>}
            {!!c.spells_known?.length && <><div style={styl}>{dp.sheet.spellsKnown}</div><ul style={{ paddingLeft: '16px', fontSize: '11px', color: '#b8a878', lineHeight: 1.7, marginBottom: '8px' }}>{c.spells_known.map(s => <li key={s}>{s}</li>)}</ul></>}
          </>
        ) : null}

        <div style={styl}>{dp.sheet.equipment}</div>
        <div style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', color: '#e8d090', marginBottom: '4px' }}>{fmt(dp.sheet.purse, { gold: g.gold })}</div>
        <ul style={{ paddingLeft: '16px', fontSize: '11px', color: '#b8a878', lineHeight: 1.7, marginBottom: '8px' }}>{g.inv.map((i, idx) => <li key={idx}>{i}</li>)}</ul>

        <div style={styl}>{dp.sheet.features}</div>
        <div style={{ fontSize: '11px', color: '#b8a878', lineHeight: 1.7, marginBottom: '8px' }}>{c.features.map((f, idx) => <div key={idx} style={{ marginBottom: '3px' }}><strong style={{ color: '#e8d090' }}>{f.name}</strong>: {f.description}</div>)}</div>

        {g.notes && (<><div style={styl}>{dp.sheet.notes}</div><div style={{ fontSize: '10px', color: '#7a6840', fontStyle: 'italic' }}>{g.notes}</div></>)}
      </div>
    </div>
  )
}

// ─── Saves modal ───────────────────────────────────────────────────────────

function SavesModal({ g, dict, allSaves, onLoad, onSave, onDelete, onClose }: {
  g: G; dict: Dictionary; allSaves: { slot: number; data: SlotData }[]
  onLoad: (slot: number) => void; onSave: (slot: number) => void; onDelete: (slot: number) => void
  onClose: () => void
}) {
  const dp = dict.play
  const SLOTS = [1, 2, 3]
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: '#1a1610', border: '1px solid #3a3020', width: '100%', maxWidth: '400px', padding: '16px' }}>
        <div style={{ fontFamily: "'Cinzel Decorative', cursive", fontSize: '14px', color: '#c9952a', marginBottom: '14px', textAlign: 'center' }}>{dp.saves.title}</div>
        {SLOTS.map(slot => {
          const found = allSaves.find(s => s.slot === slot)
          const d = found?.data
          return (
            <div key={slot} style={{ background: '#241f17', border: '1px solid #3a3020', padding: '10px', marginBottom: '8px' }}>
              {d ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', color: '#80e090', fontWeight: 600 }}>
                      {fmt(dp.saves.slotChar, { slot, name: g.char?.id === d.cid ? g.char.name : (d.charName || d.cid) })}
                    </div>
                    <div style={{ fontFamily: "'Cinzel', serif", fontSize: '8px', color: '#7a6840', letterSpacing: '1px', marginTop: '2px' }}>
                      {fmt(dp.saves.turns, { at: d.at, t: d.t })}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button onClick={() => onLoad(slot)} style={{ fontFamily: "'Cinzel', serif", fontSize: '9px', padding: '5px 10px', background: 'rgba(42,107,58,0.2)', border: '1px solid #3d9954', color: '#80e090', cursor: 'pointer' }}>{dp.saves.load}</button>
                    {g.char && <button onClick={() => onSave(slot)} style={{ fontFamily: "'Cinzel', serif", fontSize: '9px', padding: '5px 10px', background: 'rgba(201,149,42,0.1)', border: '1px solid #c9952a', color: '#c9952a', cursor: 'pointer' }}>{dp.saves.overwrite}</button>}
                    <button onClick={() => onDelete(slot)} style={{ fontFamily: "'Cinzel', serif", fontSize: '9px', padding: '5px 10px', background: 'transparent', border: '1px solid #3a3020', color: '#7a6840', cursor: 'pointer' }}>{dp.saves.delete}</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: "'Cinzel', serif", fontSize: '10px', color: '#3a3020', fontStyle: 'italic' }}>{fmt(dp.saves.empty, { slot })}</span>
                  {g.char && <button onClick={() => onSave(slot)} style={{ fontFamily: "'Cinzel', serif", fontSize: '9px', padding: '5px 10px', background: 'rgba(42,107,58,0.2)', border: '1px solid #3d9954', color: '#80e090', cursor: 'pointer' }}>{dp.saves.save}</button>}
                </div>
              )}
            </div>
          )
        })}
        <button onClick={onClose} style={{ width: '100%', fontFamily: "'Cinzel', serif", fontSize: '10px', letterSpacing: '1px', padding: '10px', background: 'transparent', border: '1px solid #3a3020', color: '#7a6840', cursor: 'pointer', marginTop: '6px' }}>{dp.saves.close}</button>
      </div>
    </div>
  )
}

function msgStyle(msg: LogMsg): React.CSSProperties {
  const base: React.CSSProperties = { fontSize: '13px', lineHeight: 1.6, padding: '6px 0' }
  switch (msg.type) {
    case 'dm': return { ...base, borderLeft: '2px solid #3a3020', paddingLeft: '10px' }
    case 'pl': return { ...base, borderLeft: '2px solid #2a6b3a', paddingLeft: '10px', color: '#e8d090' }
    case 'cbt': return { ...base, fontFamily: "'Cinzel', serif", fontSize: '10px', letterSpacing: '0.5px', color: '#ff9050' }
    case 'sys': return { ...base, fontFamily: "'Cinzel', serif", fontSize: '9px', letterSpacing: '1px', color: '#7a6840', textAlign: 'center' }
    case 'roll': {
      const colors: Record<string, string> = { crit: '#ffcc70', fmbl: '#ff6050', ok: '#80e090', fail: '#ff8070' }
      return { ...base, fontFamily: "'JetBrains Mono', monospace", fontSize: '10px', color: (msg.cls && colors[msg.cls]) || '#b8a878' }
    }
    default: return base
  }
}
