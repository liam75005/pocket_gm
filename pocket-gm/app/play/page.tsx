'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { CHARS } from '@/lib/game/characters'
import { extractAllBlocks, safeParseJSON } from '@/lib/game/protocol'
import type { PendingRoll, InitiativeEntry, TokenUsage, Character, DynamicStateForAPI } from '@/lib/types'

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
  battleMap: string | null
  battleMapLegend: string
  awaitingReaction: boolean
  gameEnded: boolean
  tokens: TokenUsage
}

const QA_TEXTS = [
  "J'observe attentivement mon environnement.",
  'Je parle a cette personne.',
  'Je fouille soigneusement.',
  "J'attaque.",
  'Je prends un repos court (1 heure).',
  'Rappelle-moi ma situation et mes ressources actuelles.',
]

function mS(v: number) { const m = Math.floor((v - 10) / 2); return m >= 0 ? `+${m}` : `${m}` }
function rRaw(s: number) { return Math.floor(Math.random() * s) + 1 }
function fmt(t: string) {
  return t
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>')
}

const defaultG = (): G => ({
  char: null, hp: 0, hpMax: 0, inv: [], conds: [], notes: '', gold: 0,
  history: [], spUsed: { 1: 0 }, dSucc: 0, dFail: 0,
  pendRoll: null, rollsDone: [], rollCnt: 0,
  inCombat: false, combatRound: 1, initiative: [], currentTurn: 0,
  battleMap: null, battleMapLegend: '', awaitingReaction: false, gameEnded: false,
  tokens: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, calls: 0 },
})

// ─── Save/Load API helpers ───────────────────────────────────────────────────

interface SlotData { cid: string; s: Omit<G, 'char' | 'pendRoll' | 'rollsDone' | 'rollCnt' | 'awaitingReaction' | 'gameEnded' | 'tokens'>; log: LogMsg[]; at: string; t: number }

async function apiSave(slot: number, cid: string, g: G, log: LogMsg[]) {
  const body: SlotData = { cid, s: { hp: g.hp, hpMax: g.hpMax, inv: g.inv, conds: g.conds, notes: g.notes, gold: g.gold, history: g.history, spUsed: g.spUsed, dSucc: g.dSucc, dFail: g.dFail, inCombat: g.inCombat, combatRound: g.combatRound, initiative: g.initiative, currentTurn: g.currentTurn, battleMap: g.battleMap, battleMapLegend: g.battleMapLegend }, log, at: new Date().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }), t: g.history.filter(m => m.role === 'user').length }
  await fetch('/api/saves', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slot, characterId: cid, state: body, logHtml: null, turnCount: body.t }) })
}

async function apiLoad(slot: number): Promise<{ data: SlotData } | null> {
  const res = await fetch(`/api/saves?slot=${slot}`)
  const json = await res.json()
  if (!json.saves || !json.saves[0]) return null
  return { data: json.saves[0].state as SlotData }
}

async function apiDelete(slot: number) {
  await fetch(`/api/saves?slot=${slot}`, { method: 'DELETE' })
}

async function apiLoadAll(): Promise<{ slot: number; data: SlotData }[]> {
  const res = await fetch('/api/saves')
  const json = await res.json()
  if (!json.saves) return []
  return json.saves.map((s: { slot: number; state: SlotData }) => ({ slot: s.slot, data: s.state }))
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function PlayPage() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('select')
  const [selId, setSelId] = useState<string | null>(null)
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
  const [bmCollapsed, setBmCollapsed] = useState(false)
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

  // scroll log to bottom
  useEffect(() => { if (logEl.current) logEl.current.scrollTop = logEl.current.scrollHeight }, [log, loading, inlineError])

  // toast auto-dismiss
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  // load saves list on mount and when entering select phase
  useEffect(() => {
    if (phase === 'select') { apiLoadAll().then(setAllSaves).catch(() => {}) }
  }, [phase])

  // ── helpers ──────────────────────────────────────────────────────────────

  const showToast = (msg: string, err?: boolean) => setToast({ msg, err })

  const nextId = () => { const id = msgCntRef.current + 1; setMsgCounter(id); return id }

  const addMsg = useCallback((type: LogMsg['type'], text: string, cls?: string) => {
    const msg: LogMsg = { id: nextId(), type, text, cls }
    setLog(prev => [...prev, msg])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateG = (updater: (prev: G) => G) => {
    setG(prev => { const next = updater(prev); gRef.current = next; return next })
  }

  // ── Game start ────────────────────────────────────────────────────────────

  function startGame() {
    const c = CHARS.find(x => x.id === selId)
    if (!c) return
    const startGold = c.eq.reduce((acc, item) => {
      const m = item.match(/^(\d+)\s*po$/)
      return m ? acc + parseInt(m[1]) : acc
    }, 0)
    const fresh = defaultG()
    fresh.char = c; fresh.hp = c.hp; fresh.hpMax = c.hp; fresh.inv = [...c.eq]
    fresh.gold = startGold || 15; fresh.spUsed = { 1: 0 }
    setG(fresh); gRef.current = fresh
    setLog([]); setPhase('play')
    setTimeout(() => callDM('BEGIN', false, fresh), 50)
  }

  // ── Combat ────────────────────────────────────────────────────────────────

  function startCombat(enemies: { name: string; dexMod?: number; init?: number; ref?: string; isAlly?: boolean }[], battleMap: { grid: string; legend: string } | null, opts: { playerSurprised?: boolean; surprisedRefs?: string[] }) {
    const playerSurprised = !!opts.playerSurprised
    const surprisedRefs = opts.surprisedRefs || []

    function rollInit(mod: number, surprised: boolean) {
      if (surprised) {
        const d1 = rRaw(20), d2 = rRaw(20), lo = Math.min(d1, d2)
        return { result: lo + mod, detail: `d20[${d1},${d2}→${lo} SURPRIS]${mod >= 0 ? '+' : ''}${mod}=${lo + mod}` }
      }
      const d = rRaw(20)
      return { result: d + mod, detail: `d20[${d}]${mod >= 0 ? '+' : ''}${mod}=${d + mod}` }
    }

    updateG(prev => {
      const c = prev.char!
      const initiative: InitiativeEntry[] = []
      const playerMod = parseInt(c.init.replace('+', ''))
      const pr = rollInit(playerMod, playerSurprised)
      initiative.push({ name: c.nm, init: pr.result, isPlayer: true, isAlly: false, alive: true, ref: 'player', surprised: playerSurprised })
      addMsg('roll', `Initiative ${c.nm}${playerSurprised ? ' (Surpris, désavantage)' : ''} : ${pr.detail}`)

      enemies.forEach(e => {
        const dexMod = typeof e.dexMod === 'number' ? e.dexMod : 0
        const enemySurprised = surprisedRefs.indexOf(e.ref || '') !== -1 || surprisedRefs.indexOf(e.name) !== -1
        let enemyInit: number
        if (typeof e.dexMod === 'number') {
          const er = rollInit(dexMod, enemySurprised)
          enemyInit = er.result
          addMsg('roll', `Initiative ${e.name}${e.isAlly ? ' (allié)' : ''}${enemySurprised ? ' (Surpris)' : ''} : ${er.detail}`)
        } else {
          enemyInit = e.init || 10
          addMsg('roll', `Initiative ${e.name}${e.isAlly ? ' (allié)' : ''} : ${enemyInit}`)
        }
        initiative.push({ name: e.name, init: enemyInit, isPlayer: false, isAlly: !!e.isAlly, alive: true, ref: e.ref || e.name, surprised: enemySurprised })
      })

      initiative.sort((a, b) => b.init !== a.init ? b.init - a.init : a.isPlayer ? 1 : -1)

      addMsg('sys', '═══════════════════════')
      addMsg('cbt', '⚔ ⚔ ⚔  COMBAT ENGAGÉ  ⚔ ⚔ ⚔')
      addMsg('sys', '═══════════════════════')
      const order = initiative.map(t => `${t.name}(${t.init})`).join(' → ')
      addMsg('cbt', `📋 Ordre d'initiative : ${order}`)

      const first = initiative[0]
      if (first?.isPlayer) addMsg('cbt', '▶ VOUS AGISSEZ EN PREMIER — Décrivez votre action')
      else if (first?.isAlly) { addMsg('cbt', `🤝 ${first.name} (allié) agit en premier`); setShowManualNext(first) }
      else { addMsg('cbt', `⏳ ${first?.name} agit en premier`); setShowManualNext(first) }

      return {
        ...prev,
        inCombat: true, combatRound: 1, initiative, currentTurn: 0,
        battleMap: battleMap?.grid || null,
        battleMapLegend: battleMap?.legend || 'P=Vous · E=Ennemi · #=Mur · .=Sol',
      }
    })
  }

  function endCombat() {
    updateG(prev => ({ ...prev, inCombat: false, initiative: [], battleMap: null }))
    setShowManualNext(null)
    addMsg('cbt', '✓ COMBAT TERMINÉ')
  }

  function killEnemy(name: string) {
    updateG(prev => ({
      ...prev,
      initiative: prev.initiative.map(t => t.name === name ? { ...t, alive: false, dead: true } : t),
    }))
  }

  function markDowned(name: string) {
    updateG(prev => ({
      ...prev,
      initiative: prev.initiative.map(t => t.name === name ? { ...t, downed: true } : t),
    }))
  }

  function markStabilized(name: string) {
    updateG(prev => ({
      ...prev,
      initiative: prev.initiative.map(t => t.name === name ? { ...t, stabilized: true, downed: false } : t),
    }))
  }

  function revive(name: string) {
    updateG(prev => ({
      ...prev,
      initiative: prev.initiative.map(t => t.name === name ? { ...t, downed: false, stabilized: false, alive: true } : t),
    }))
  }

  function updateBattleMap(grid: string, legend: string) {
    updateG(prev => ({ ...prev, battleMap: grid, battleMapLegend: legend }))
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
          addMsg('cbt', `▶ [Round ${combatRound}] VOTRE TOUR — Décrivez votre action`)
          if (prev.hp <= 0 && prev.conds.includes('Inconscient')) {
            setTimeout(() => {
              addMsg('cbt', '⚠ Jet de mort requis (0 PV)')
              requestRoll({ dice: 20, mod: 0, modLabel: 'aucun', type: 'death', label: 'Jet de mort', dc: 10, advantage: null })
            }, 50)
          }
        } else {
          addMsg('cbt', `⏳ Tour de ${curr.name}${curr.isAlly ? ' (allié)' : ''}`)
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
    const prefix = curr.isAlly ? '[TOUR AUTO - ALLIÉ]' : '[TOUR AUTO - ENNEMI]'
    callDM(`${prefix} C'est le tour de ${curr.name}. Joue ce tour.`, false)
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
      addMsg('roll', `d${sides} → ${r} (1er jet, relancez)`)
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
    const dc = p.dc != null ? (succ ? ' ✓' : ' ✗') + ` DD${p.dc}` : ''
    const prefix = isCrit ? 'CRITIQUE ! ' : isFmbl ? 'FUMBLE ! ' : ''
    const modPart = p.mod !== 0 ? `${p.mod > 0 ? '+' : ''}${p.mod}=${total}` : ''
    addMsg('roll', `${prefix}d${sides} ${rs}${modPart}${dc}`, cls)

    if (p.type === 'death') {
      if (fr === 20) {
        updateG(prev => {
          const conds = prev.conds.filter(x => x !== 'Inconscient')
          return { ...prev, hp: 1, dSucc: 0, dFail: 0, conds, pendRoll: null, rollsDone: [] }
        })
        addMsg('cbt', '20 NATUREL sur jet de mort ! Vous revenez à 1 PV, conscient.')
        if (gRef.current.inCombat) setTimeout(nextTurn, 50)
        return
      }
      const updatedSucc = isFmbl ? cur.dSucc : (succ ? cur.dSucc + 1 : cur.dSucc)
      const updatedFail = isFmbl ? cur.dFail + 2 : (succ ? cur.dFail : cur.dFail + 1)
      addMsg('cbt', `Stabilisation : ${updatedSucc}/3 ✓  ${updatedFail}/3 ✗`)
      if (updatedSucc >= 3) {
        addMsg('sys', '— Stabilisé (0 PV mais vivant) —')
        updateG(prev => ({ ...prev, dSucc: 0, dFail: 0, pendRoll: null, rollsDone: [] }))
        if (gRef.current.inCombat) setTimeout(nextTurn, 50)
        return
      }
      if (updatedFail >= 3) { gameOver(); return }
      updateG(prev => ({ ...prev, dSucc: updatedSucc, dFail: updatedFail, pendRoll: null, rollsDone: [] }))
      if (gRef.current.inCombat) {
        addMsg('sys', 'Vous restez à 0 PV (inconscient). Prochain jet de mort à votre prochain tour.')
        setTimeout(nextTurn, 50)
      } else {
        setTimeout(() => requestRoll({ dice: 20, mod: 0, modLabel: 'aucun', type: 'death', label: 'Jet de mort (suite)', dc: 10, advantage: null }), 50)
      }
      return
    }

    const done = { label: p.label, dice: p.dice, mod: p.mod, fr, total, succ, isCrit, isFmbl, advantage: p.advantage, dc: p.dc, rolls: newRolls }
    updateG(prev => ({ ...prev, pendRoll: null, rollsDone: [] }))
    const rm = buildRM(done, newRolls)
    setTimeout(() => callDM(rm, true), 50)
  }

  function buildRM(r: { label: string; dice: number; mod: number; fr: number; total: number; succ: boolean | null; isCrit: boolean; isFmbl: boolean; advantage: string | null; dc: number | null }, rolls: number[]) {
    let m = `[RESULTAT] ${r.label}: d${r.dice}`
    if (rolls.length > 1) m += ` [${rolls.join(',')}]->${r.fr}`
    else m += `->${r.fr}`
    if (r.mod !== 0) m += ` ${r.mod >= 0 ? '+' : ''}${r.mod}=${r.total}`
    if (r.dc != null) m += ` vs DD${r.dc} -> ${r.succ ? 'SUCCES' : 'ECHEC'}`
    if (r.isCrit) m += ' [CRITIQUE 2xdes]'
    if (r.isFmbl) m += ' [FUMBLE]'
    if (r.advantage) m += ` [${r.advantage === 'advantage' ? 'Avantage' : 'Desavantage'}]`
    return m
  }

  // ── API call ──────────────────────────────────────────────────────────────

  async function callDM(msg: string, isRoll: boolean, overrideG?: G) {
    const cur = overrideG || gRef.current
    if (cur.gameEnded) return

    const content = msg === 'BEGIN'
      ? "Commence l'aventure. Le personnage arrive a HOMMLET, village paisible de Furyondy (Greyhawk), pour son premier contrat d'aventurier. Decris l'arrivee en fin d'apres-midi, l'atmosphere rustique mais un peu tendue du village, l'enseigne de l'auberge du Laboureur Accueillant. Pas de jet au depart - laisse le joueur reagir et decider de ses actions (entrer a l'auberge, parler aux villageois, etc.). Respecte l'ACTE 1 : amene naturellement le joueur a rencontrer le compagnon approprie a sa classe (voir REGLE DE COMPLEMENTARITE)."
      : msg

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
        body: JSON.stringify({ messages: newHistory, characterId: cur.char!.id, dynamicState }),
      })

      if (!res.ok) {
        const text = await res.text()
        let detail = text
        try { const j = JSON.parse(text); if (j.error) detail = j.error } catch {}
        throw new Error(`HTTP ${res.status} — ${detail.substring(0, 200)}`)
      }

      const data = await res.json()
      const raw: string = data.content || '*(Silence...)*'
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

      // REACTION blocks
      const reactionBlocks = extractAllBlocks(clean, 'REACTION')
      reactionBlocks.forEach(rb => {
        const parsed = safeParseJSON(rb)
        if (!parsed?.REACTION) return
        clean = clean.replace(rb, '')
        updateG(prev => ({ ...prev, awaitingReaction: true }))
        const rd = parsed.REACTION as { prompt?: string }
        const promptText = rd.prompt || 'Décrivez votre réaction (ou tapez \'passe\' pour l\'ignorer)'
        addMsg('cbt', `⚡ RÉACTION POSSIBLE — ${promptText}`)
      })

      // COMBAT blocks
      const combatBlocks = extractAllBlocks(clean, 'COMBAT')
      combatBlocks.forEach(cb => {
        const parsed = safeParseJSON(cb)
        if (!parsed?.COMBAT) return
        clean = clean.replace(cb, '')
        const cdata = parsed.COMBAT as {
          start?: boolean; enemies?: { name: string; dexMod?: number; ref?: string; isAlly?: boolean }[]
          battleMap?: { grid: string; legend: string }; playerSurprised?: boolean; surprisedRefs?: string[]
          kill?: string; downed?: string; stabilized?: string; revive?: string
          mapUpdate?: string; legend?: string; end?: boolean
        }
        if (cdata.start) startCombat(cdata.enemies || [], cdata.battleMap || null, { playerSurprised: cdata.playerSurprised, surprisedRefs: cdata.surprisedRefs })
        if (cdata.kill) { killEnemy(cdata.kill); addMsg('cbt', `☠ ${cdata.kill} est mort`) }
        if (cdata.downed) { markDowned(cdata.downed); addMsg('cbt', `🩸 ${cdata.downed} tombe inconscient (0 PV, jets de mort en cours)`) }
        if (cdata.stabilized) { markStabilized(cdata.stabilized); addMsg('cbt', `💤 ${cdata.stabilized} est stabilisé (inconscient mais hors danger)`) }
        if (cdata.revive) { revive(cdata.revive); addMsg('cbt', `✨ ${cdata.revive} revient à lui`) }
        if (cdata.mapUpdate) updateBattleMap(cdata.mapUpdate, cdata.legend || '')
        if (cdata.end) endCombat()
      })

      // TURN blocks
      const turnBlocks = extractAllBlocks(clean, 'TURN')
      turnBlocks.forEach(tb => {
        clean = clean.replace(tb, '')
        if (gRef.current.inCombat) setTimeout(nextTurn, 50)
      })

      // ROLL block
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

      // STATE blocks
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
          let next = { ...prev }
          if (u.hp !== undefined) {
            const oldHp = next.hp
            next.hp = Math.max(0, Math.min(next.hpMax, u.hp))
            if (oldHp <= 0 && next.hp > 0) {
              next.conds = next.conds.filter(x => x !== 'Inconscient')
              next.dSucc = 0; next.dFail = 0
              addMsg('cbt', `✨ Vous reprenez conscience à ${next.hp} PV !`)
            }
          }
          if (u.addItem) { next.inv = [...next.inv, u.addItem]; addMsg('sys', `📦 +${u.addItem}`) }
          if (u.removeItem) { next.inv = next.inv.filter(i => i !== u.removeItem); addMsg('sys', `📦 −${u.removeItem}`) }
          if (u.addCond && !next.conds.includes(u.addCond)) next.conds = [...next.conds, u.addCond]
          if (u.removeCond) next.conds = next.conds.filter(x => x !== u.removeCond)
          if (u.useSlot != null) {
            const lv = u.useSlot
            const total = (next.char?.sp?.sl[lv]) || 0
            const used = next.spUsed[lv] || 0
            if (used >= total) addMsg('sys', `⚠️ ERREUR MJ : emplacement niv.${lv} déjà épuisé (${used}/${total}).`)
            else { next.spUsed = { ...next.spUsed, [lv]: used + 1 }; addMsg('sys', `✨ Emplacement niv.${lv} utilisé (${used + 1}/${total})`) }
          }
          if (u.note) { next.notes = next.notes ? next.notes + '\n· ' + u.note : '· ' + u.note }
          if (typeof u.gold === 'number') { next.gold = Math.max(0, u.gold); addMsg('sys', `💰 Bourse : ${next.gold} po`) }
          if (typeof u.goldDelta === 'number') { next.gold = Math.max(0, next.gold + u.goldDelta); addMsg('sys', `💰 ${u.goldDelta >= 0 ? '+' : ''}${u.goldDelta} po (total : ${next.gold} po)`) }
          return next
        })
      })

      const trimmed = clean.trim()
      if (trimmed) addMsg('dm', trimmed)

      updateG(prev => ({ ...prev, history: [...prev.history, { role: 'assistant', content: raw }] }))
      autoSave()

      // Refusal detection
      const hasMarker = /\{"(ROLL|STATE|COMBAT|TURN|REACTION)":/.test(raw)
      const refusalKeywords = /je ne peux pas|je préfère|je n'ai pas la possibilité|inapproprié|je ne suis pas à l'aise|cela dépasse|en tant qu'IA|je vais devoir|reformuler/i
      const looksLikeRefusal = !hasMarker && refusalKeywords.test(trimmed) && trimmed.length < 600
      if (looksLikeRefusal) {
        addMsg('sys', '⚠ Le MJ a refusé de traiter votre demande')
        addMsg('cbt', '💡 Astuce : reformulez en termes purement mécaniques RPG.')
        const curG = gRef.current
        if (curG.inCombat && !curG.gameEnded) {
          const curr = curG.initiative[curG.currentTurn]
          if (curr && !curr.isPlayer) setTimeout(() => { if (gRef.current.inCombat && !gRef.current.pendRoll) { addMsg('sys', '⏭ Tour passé automatiquement (refus du MJ)'); nextTurn() } }, 2000)
        }
      }

      // Player at 0 HP
      const curG = gRef.current
      if (curG.hp <= 0 && !curG.conds.includes('Mort') && !curG.conds.includes('Inconscient')) {
        updateG(prev => ({ ...prev, dSucc: 0, dFail: 0, conds: [...prev.conds, 'Inconscient'] }))
        if (curG.inCombat) {
          addMsg('cbt', '⚠ Vous tombez INCONSCIENT à 0 PV. Le combat continue. Votre jet de mort se fera à votre prochain tour.')
          const cur = curG.initiative[curG.currentTurn]
          if (cur?.isPlayer) setTimeout(nextTurn, 50)
        } else {
          addMsg('cbt', '⚠ INCONSCIENT — Jet de stabilisation requis (d20 DD10 sans mod.)')
          setTimeout(() => requestRoll({ dice: 20, mod: 0, modLabel: 'aucun', type: 'death', label: 'Jet de mort', dc: 10, advantage: null }), 50)
        }
      }

    } catch (e) {
      const msg = (e as Error).message || 'inconnu'
      addMsg('sys', `⚠ Erreur API — ${msg}`)
      setInlineError('Something went wrong — try again')
      if (/500|502|503|529/.test(msg)) {
        addMsg('sys', '💡 Erreur serveur transitoire. Retapez votre dernier message dans 5-10 secondes.')
        updateG(prev => {
          const h = [...prev.history]
          if (h.length > 0 && h[h.length - 1].role === 'user') h.pop()
          return { ...prev, history: h }
        })
      } else if (/429/.test(msg)) {
        addMsg('sys', '💡 Limite de débit (429). Attendez 30-60 secondes.')
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

  // ── Send message ──────────────────────────────────────────────────────────

  function sendMsg() {
    const cur = gRef.current
    if (cur.pendRoll) { addMsg('sys', '— Lancez le dé requis —'); return }
    if (cur.inCombat && cur.initiative.length && !cur.awaitingReaction) {
      const curr = cur.initiative[cur.currentTurn]
      if (curr && !curr.isPlayer) { addMsg('sys', `— Ce n'est pas votre tour (${curr.name} agit) —`); return }
    }
    const text = inputText.trim()
    if (!text) return
    setInputText('')
    setInlineError(null)
    if (cur.awaitingReaction) {
      updateG(prev => ({ ...prev, awaitingReaction: false }))
      addMsg('pl', `[RÉACTION] ${text}`)
      callDM(`[REPONSE REACTION JOUEUR] ${text} — Continue ensuite le tour de l'ennemi/allie en cours.`, false)
      return
    }
    addMsg('pl', text)
    autoSave()
    callDM(text, false)
  }

  // ── Save / Load ───────────────────────────────────────────────────────────

  const autoSave = useCallback(() => {
    const cur = gRef.current
    if (!cur.char) return
    apiSave(0, cur.char.id, cur, logRef.current).catch(() => {})
  }, [])

  async function saveGame(slot: number) {
    const cur = gRef.current
    if (!cur.char) { showToast('Pas de partie', true); return }
    try {
      await apiSave(slot, cur.char.id, cur, logRef.current)
      showToast(`Sauvegarde ${slot} OK`)
      const updated = await apiLoadAll()
      setAllSaves(updated)
    } catch (e) {
      showToast(`Erreur: ${(e as Error).message.substring(0, 50)}`, true)
    }
  }

  async function loadGame(slot: number) {
    try {
      const result = await apiLoad(slot)
      if (!result) { showToast(`Slot ${slot} vide`, true); return }
      const d = result.data
      const ch = CHARS.find(c => c.id === d.cid)
      if (!ch) { showToast(`Personnage introuvable: ${d.cid}`, true); return }
      const restored = defaultG()
      restored.char = ch; restored.hp = d.s.hp; restored.hpMax = d.s.hpMax
      restored.inv = d.s.inv || []; restored.conds = d.s.conds || []
      restored.notes = d.s.notes || ''; restored.history = d.s.history || []
      restored.spUsed = d.s.spUsed || { 1: 0 }
      restored.gold = typeof d.s.gold === 'number' ? d.s.gold : 15
      restored.inCombat = d.s.inCombat || false
      restored.combatRound = d.s.combatRound || 1
      restored.initiative = d.s.initiative || []
      restored.currentTurn = d.s.currentTurn || 0
      restored.battleMap = d.s.battleMap || null
      restored.battleMapLegend = d.s.battleMapLegend || ''
      setG(restored); gRef.current = restored
      setLog(d.log || [])
      setPhase('play')
      setShowSaves(false)
      showToast(`Slot ${slot} chargé (${ch.nm})`)
    } catch (e) {
      showToast(`Erreur load: ${(e as Error).message.substring(0, 50)}`, true)
    }
  }

  async function delGame(slot: number) {
    await apiDelete(slot)
    showToast('Effacé')
    const updated = await apiLoadAll()
    setAllSaves(updated)
  }

  // ── Game over ─────────────────────────────────────────────────────────────

  function gameOver() {
    updateG(prev => ({ ...prev, gameEnded: true }))
    addMsg('cbt', '💀 MORT — Votre personnage est mort.')
    addMsg('sys', '═══════════ GAME OVER ═══════════')
  }

  async function abandonGame() {
    updateG(defaultG); setLog([]); setPhase('select')
    await apiDelete(0)
  }

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  // ── Token cost display ────────────────────────────────────────────────────

  function tokenLabel(t: TokenUsage) {
    const total = t.input + t.output + t.cacheCreate + t.cacheRead
    if (total === 0) return '🪙 0'
    const k = Math.round(total / 100) / 10
    return `🪙 ${k}k`
  }

  // ── Input lock helpers ────────────────────────────────────────────────────

  function isInputLocked() {
    const cur = gRef.current
    if (loading) return true
    if (cur.pendRoll) return true
    if (cur.gameEnded) return true
    if (cur.inCombat && cur.initiative.length && !cur.awaitingReaction) {
      const curr = cur.initiative[cur.currentTurn]
      if (curr && !curr.isPlayer) return true
    }
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

  // ── Render: character sheet ───────────────────────────────────────────────

  function SheetModal() {
    const c = g.char; if (!c) return null
    const pct = Math.max(0, g.hp / g.hpMax * 100)
    const bc = pct > 50 ? '#2a6b3a' : pct > 25 ? '#c9952a' : '#9b2318'
    const styl = { fontFamily: "'Cinzel', serif", fontSize: '8px', letterSpacing: '2px', color: '#b8a878', textTransform: 'uppercase' as const, marginTop: '12px', marginBottom: '4px' }
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 200, overflowY: 'auto', padding: '16px' }} onClick={e => { if (e.target === e.currentTarget) setShowSheet(false) }}>
        <div style={{ background: '#1a1610', border: '1px solid #3a3020', maxWidth: '500px', margin: '0 auto', padding: '16px', position: 'relative' }}>
          <button onClick={() => setShowSheet(false)} style={{ position: 'absolute', top: '8px', right: '8px', background: 'transparent', border: '1px solid #3a3020', color: '#7a6840', cursor: 'pointer', padding: '4px 8px', fontFamily: "'Cinzel', serif", fontSize: '9px' }}>✕ Fermer</button>
          <div style={{ fontFamily: "'Cinzel Decorative', cursive", fontSize: '14px', color: '#c9952a', marginBottom: '2px' }}>{c.nm}</div>
          <div style={{ fontFamily: "'Cinzel', serif", fontSize: '8px', color: '#c8392b', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '8px' }}>{c.sub}</div>
          <div style={{ fontSize: '10px', color: '#b8a878', background: 'rgba(255,255,255,0.02)', border: '1px solid #3a3020', padding: '6px', marginBottom: '8px' }}>📜 Background : {c.background} — {c.bgDesc}</div>

          <div style={styl}>Caractéristiques</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: '4px', marginBottom: '8px' }}>
            {(Object.keys(c.stats) as Array<keyof typeof c.stats>).map(k => (
              <div key={k} style={{ background: '#241f17', border: '1px solid #3a3020', padding: '4px', textAlign: 'center' }}>
                <div style={{ fontFamily: "'Cinzel', serif", fontSize: '6px', color: '#7a6840' }}>{k}</div>
                <div style={{ fontSize: '14px', fontWeight: 600 }}>{c.stats[k]}</div>
                <div style={{ fontSize: '10px', color: '#c9952a' }}>{mS(c.stats[k])}</div>
              </div>
            ))}
          </div>

          <div style={styl}>PV · CA · Init · BM</div>
          <div style={{ marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontFamily: "'Cinzel', serif", fontSize: '9px', color: '#7a6840' }}>PV</span>
            <span style={{ fontSize: '14px', fontWeight: 600 }}>{g.hp} / {g.hpMax}</span>
          </div>
          <div style={{ height: '6px', background: '#241f17', border: '1px solid #3a3020', marginBottom: '8px' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: bc, transition: 'width 0.3s' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '4px', marginBottom: '8px' }}>
            {[['CA', String(c.ca)], ['INIT', c.init], ['BM', '+2']].map(([l, v]) => (
              <div key={l} style={{ background: '#241f17', border: '1px solid #3a3020', padding: '6px', textAlign: 'center' }}>
                <div style={{ fontFamily: "'Cinzel', serif", fontSize: '6px', color: '#7a6840' }}>{l}</div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: l === 'BM' ? '#c9952a' : '#f0ead8' }}>{v}</div>
              </div>
            ))}
          </div>

          {g.conds.length > 0 && (<><div style={styl}>Conditions</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>{g.conds.map(c => <span key={c} style={{ background: 'rgba(155,35,24,0.2)', border: '1px solid #c8392b', color: '#ff8070', padding: '2px 6px', fontSize: '10px', fontFamily: "'Cinzel', serif" }}>{c}</span>)}</div></>)}

          {c.sp && (
            <>
              <div style={styl}>Emplacements de sorts</div>
              {Object.keys(c.sp.sl).map(lv => {
                const tot = c.sp!.sl[+lv]; const used = g.spUsed[+lv] || 0
                return (
                  <div key={lv} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <span style={{ fontFamily: "'Cinzel', serif", fontSize: '8px', color: '#7a6840' }}>Niv.{lv}:</span>
                    {Array.from({ length: tot }).map((_, i) => <div key={i} style={{ width: '12px', height: '12px', borderRadius: '50%', background: i < used ? '#241f17' : '#c9952a', border: '1px solid #3a3020' }} />)}
                    <span style={{ fontFamily: "'Cinzel', serif", fontSize: '8px', color: '#7a6840' }}>{tot - used}/{tot}</span>
                  </div>
                )
              })}
              <div style={styl}>Sorts mineurs (illimités)</div>
              <ul style={{ paddingLeft: '16px', fontSize: '11px', color: '#b8a878', lineHeight: 1.7, marginBottom: '8px' }}>{c.sp.cants.map(s => <li key={s}>{s}</li>)}</ul>
              <div style={styl}>Sorts préparés</div>
              <ul style={{ paddingLeft: '16px', fontSize: '11px', color: '#b8a878', lineHeight: 1.7, marginBottom: '8px' }}>{c.sp.prep.map(s => <li key={s}>{s}</li>)}</ul>
            </>
          )}

          <div style={styl}>Attaques</div>
          <ul style={{ paddingLeft: '16px', fontSize: '11px', color: '#b8a878', lineHeight: 1.8, marginBottom: '8px' }}>
            {c.atk.map(a => <li key={a.n}><strong>{a.n}</strong> {a.b} → {a.d}{a.note ? <em style={{ color: '#7a6840' }}> ({a.note})</em> : ''}</li>)}
          </ul>

          <div style={styl}>Inventaire</div>
          <div style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', color: '#e8d090', marginBottom: '4px' }}>💰 Bourse : <strong>{g.gold} po</strong></div>
          <ul style={{ paddingLeft: '16px', fontSize: '11px', color: '#b8a878', lineHeight: 1.7, marginBottom: '8px' }}>{g.inv.map(i => <li key={i}>{i}</li>)}</ul>

          <div style={styl}>Capacités</div>
          <div style={{ fontSize: '11px', color: '#b8a878', lineHeight: 1.7, marginBottom: '8px' }}>{c.feats.map(f => <div key={f} style={{ marginBottom: '3px' }}>{f}</div>)}</div>

          {g.notes && (<><div style={styl}>Notes</div><div style={{ fontSize: '10px', color: '#7a6840', fontStyle: 'italic' }}>{g.notes}</div></>)}
        </div>
      </div>
    )
  }

  // ── Render: saves modal ───────────────────────────────────────────────────

  function SavesModal() {
    const SLOTS = [1, 2, 3]
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }} onClick={e => { if (e.target === e.currentTarget) setShowSaves(false) }}>
        <div style={{ background: '#1a1610', border: '1px solid #3a3020', width: '100%', maxWidth: '400px', padding: '16px' }}>
          <div style={{ fontFamily: "'Cinzel Decorative', cursive", fontSize: '14px', color: '#c9952a', marginBottom: '14px', textAlign: 'center' }}>💾 Sauvegardes</div>
          {SLOTS.map(slot => {
            const found = allSaves.find(s => s.slot === slot)
            const d = found?.data
            return (
              <div key={slot} style={{ background: '#241f17', border: '1px solid #3a3020', padding: '10px', marginBottom: '8px' }}>
                {d ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', color: '#80e090', fontWeight: 600 }}>
                        Slot {slot} — {CHARS.find(c => c.id === d.cid)?.nm || d.cid}
                      </div>
                      <div style={{ fontFamily: "'Cinzel', serif", fontSize: '8px', color: '#7a6840', letterSpacing: '1px', marginTop: '2px' }}>
                        {d.at} · {d.t} tours
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button onClick={() => loadGame(slot)} style={{ fontFamily: "'Cinzel', serif", fontSize: '9px', padding: '5px 10px', background: 'rgba(42,107,58,0.2)', border: '1px solid #3d9954', color: '#80e090', cursor: 'pointer' }}>Charger</button>
                      {g.char && <button onClick={() => saveGame(slot)} style={{ fontFamily: "'Cinzel', serif", fontSize: '9px', padding: '5px 10px', background: 'rgba(201,149,42,0.1)', border: '1px solid #c9952a', color: '#c9952a', cursor: 'pointer' }}>Écraser</button>}
                      <button onClick={() => delGame(slot)} style={{ fontFamily: "'Cinzel', serif", fontSize: '9px', padding: '5px 10px', background: 'transparent', border: '1px solid #3a3020', color: '#7a6840', cursor: 'pointer' }}>Effacer</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: "'Cinzel', serif", fontSize: '10px', color: '#3a3020', fontStyle: 'italic' }}>Slot {slot} — Vide</span>
                    {g.char && <button onClick={() => saveGame(slot)} style={{ fontFamily: "'Cinzel', serif", fontSize: '9px', padding: '5px 10px', background: 'rgba(42,107,58,0.2)', border: '1px solid #3d9954', color: '#80e090', cursor: 'pointer' }}>Sauvegarder</button>}
                  </div>
                )}
              </div>
            )
          })}
          <button onClick={() => setShowSaves(false)} style={{ width: '100%', fontFamily: "'Cinzel', serif", fontSize: '10px', letterSpacing: '1px', padding: '10px', background: 'transparent', border: '1px solid #3a3020', color: '#7a6840', cursor: 'pointer', marginTop: '6px' }}>✕ Fermer</button>
        </div>
      </div>
    )
  }

  // ── Render: select screen ─────────────────────────────────────────────────

  if (phase === 'select') {
    const bdgStyle = (bdg: string): React.CSSProperties => {
      const map: Record<string, React.CSSProperties> = {
        bG: { background: 'rgba(155,35,24,.2)', border: '1px solid #c8392b', color: '#ff8070' },
        bC: { background: 'rgba(201,149,42,.15)', border: '1px solid #c9952a', color: '#e8d090' },
        bR: { background: 'rgba(26,90,154,.2)', border: '1px solid #2d7abf', color: '#7abfff' },
        bM: { background: 'rgba(100,42,154,.2)', border: '1px solid #9060dd', color: '#c090ff' },
      }
      return map[bdg] || {}
    }

    return (
      <div style={S.app}>
        <div style={S.hdr}>
          <div><div style={S.ht}>Hommlet — Scénario de test</div><div style={S.hs}>D&amp;D 2024 SRD 5.2 · Règles strictes</div></div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <span style={S.hbdg}>v2.0</span>
            <button onClick={signOut} style={{ ...S.hbtn, fontSize: '8px' }}>⏏ Déconnexion</button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '14px' }}>
          {allSaves.length > 0 && (
            <>
              <div style={{ fontFamily: "'Cinzel', serif", fontSize: '8px', letterSpacing: '3px', color: '#e8d090', textTransform: 'uppercase', marginBottom: '5px', textAlign: 'center' }}>Reprendre une partie</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px', paddingBottom: '14px', borderBottom: '1px solid #3a3020' }}>
                {allSaves.filter(s => s.slot !== 0).map(s => {
                  const ch = CHARS.find(c => c.id === s.data.cid)
                  return (
                    <div key={s.slot} onClick={() => loadGame(s.slot)} style={{ background: 'rgba(42,107,58,.1)', border: '1px solid #3d9954', padding: '9px 11px', cursor: 'pointer' }}>
                      <div style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', color: '#80e090', fontWeight: 600 }}>Slot {s.slot} — {ch?.nm || s.data.cid}</div>
                      <div style={{ fontFamily: "'Cinzel', serif", fontSize: '8px', color: '#7a6840', letterSpacing: '1px', marginTop: '2px' }}>{s.data.at} · {s.data.t} tours</div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          <div style={{ fontFamily: "'Cinzel Decorative', cursive", fontSize: '17px', color: '#c9952a', textAlign: 'center', marginBottom: '4px' }}>Nouvelle partie</div>
          <div style={{ fontFamily: "'Cinzel', serif", fontSize: '8px', letterSpacing: '2px', color: '#b8a878', textAlign: 'center', textTransform: 'uppercase', marginBottom: '10px' }}>Hommlet, Greyhawk · Niveau 1 · D&amp;D 2024</div>
          <div style={{ fontSize: '12px', color: '#b8a878', lineHeight: 1.6, border: '1px solid #3a3020', padding: '10px', background: 'rgba(255,255,255,.02)', marginBottom: '14px', fontStyle: 'italic' }}>
            <strong>Scénario de test</strong> en 3 actes à Hommlet : recrutement d'un compagnon à l'auberge, obstacle sur la route (ravin), puis embuscade de bandits. Règles D&D 2024 strictes — backgrounds, maîtrises d'armes, emplacements de sorts, combat à l'initiative. Mort permanente.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '9px' }}>
            {CHARS.map(c => (
              <div key={c.id} onClick={() => setSelId(c.id)} style={{ background: '#1e1912', border: `2px solid ${selId === c.id ? '#3d9954' : '#3a3020'}`, padding: '11px', cursor: 'pointer', position: 'relative', ...(selId === c.id ? { background: 'rgba(42,107,58,.12)' } : {}) }}>
                <span style={{ position: 'absolute', top: '7px', right: '7px', fontFamily: "'Cinzel', serif", fontSize: '7px', padding: '2px 5px', borderRadius: '2px', ...bdgStyle(c.bdg) }}>{c.bt}</span>
                <div style={{ fontFamily: "'Cinzel Decorative', cursive", fontSize: '11px', color: '#c9952a', marginBottom: '2px' }}>{c.nm}</div>
                <div style={{ fontFamily: "'Cinzel', serif", fontSize: '7px', letterSpacing: '2px', color: '#c8392b', textTransform: 'uppercase', marginBottom: '6px' }}>{c.sub}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '2px', marginBottom: '6px' }}>
                  {c.ks.map(k => (
                    <div key={k.l} style={{ background: '#241f17', border: '1px solid #3a3020', padding: '3px', textAlign: 'center' }}>
                      <span style={{ fontFamily: "'Cinzel', serif", fontSize: '6px', color: '#7a6840', display: 'block' }}>{k.l}</span>
                      <span style={{ fontSize: '12px', color: '#f0ead8', fontWeight: 600 }}>{k.v}</span>
                    </div>
                  ))}
                </div>
                <ul style={{ fontSize: '10px', color: '#b8a878', lineHeight: 1.6, listStyle: 'none', paddingLeft: 0 }}>
                  {c.feats.slice(0, 2).map(f => <li key={f} style={{ paddingLeft: '8px', position: 'relative' }}><span style={{ position: 'absolute', left: 0, color: '#c9952a' }}>·</span>{f}</li>)}
                  <li style={{ paddingLeft: '8px', position: 'relative', color: '#7a6840', fontStyle: 'italic' }}><span style={{ position: 'absolute', left: 0, color: '#c9952a' }}>·</span>{c.desc}</li>
                </ul>
              </div>
            ))}
          </div>

          <button
            onClick={startGame}
            disabled={!selId}
            style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase', padding: '14px', background: '#2a6b3a', border: '2px solid #3d9954', color: '#fff', cursor: selId ? 'pointer' : 'not-allowed', width: '100%', marginTop: '14px', fontWeight: 600, opacity: selId ? 1 : 0.3 }}
          >
            ⚔ Partir à l'aventure
          </button>
        </div>
      </div>
    )
  }

  // ── Render: play screen ───────────────────────────────────────────────────

  const pendRoll = g.pendRoll
  const inputLocked = isInputLocked()
  const tokens = g.tokens

  return (
    <div style={S.app}>
      {/* Header */}
      <div style={S.hdr}>
        <div><div style={S.ht}>Hommlet — Test</div><div style={S.hs}>D&amp;D 2024 · Combat strict</div></div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          {g.inCombat && <button onClick={() => setShowDrawer(true)} style={{ ...S.hbtn, background: 'rgba(155,35,24,.2)', borderColor: '#c8392b', color: '#ff9050', fontSize: '9px', fontWeight: 600 }}>⚔ Combat</button>}
          <span style={S.hbdg}>{g.hp}/{g.hpMax} PV</span>
          <button onClick={() => setShowTokenDetail(true)} style={{ ...S.hbtn, fontSize: '8px' }}>{tokenLabel(tokens)}</button>
          <button onClick={() => { apiLoadAll().then(setAllSaves); setShowSaves(true) }} style={S.hbtn}>💾</button>
          <button onClick={abandonGame} style={{ ...S.hbtn, borderColor: '#c8392b', color: '#ff8070' }}>⏏</button>
        </div>
      </div>

      {/* Roll banner */}
      {pendRoll && (
        <div style={{ background: '#7a4f0a', borderBottom: '1px solid #c8820a', padding: '6px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: "'Cinzel', serif", fontSize: '8px', letterSpacing: '2px', color: '#ffcc70', textTransform: 'uppercase' }}>⚠ Jet requis</div>
            <div style={{ fontSize: '11px', color: '#ffe090', fontWeight: 600 }}>{pendRoll.label}{pendRoll.dc ? ` · DD${pendRoll.dc}` : ''}</div>
          </div>
          <span style={{ fontFamily: "'Cinzel', serif", fontSize: '7px', padding: '2px 5px', borderRadius: '2px', color: '#fff', background: pendRoll.advantage === 'advantage' ? '#2a6b3a' : pendRoll.advantage === 'disadvantage' ? '#9b2318' : '#445' }}>
            {pendRoll.advantage === 'advantage' ? 'Avantage' : pendRoll.advantage === 'disadvantage' ? 'Désavantage' : 'Normal'}
          </span>
        </div>
      )}

      {/* Combat tracker */}
      {g.inCombat && (
        <div style={{ background: '#1a1610', borderBottom: '1px solid #c8392b', flexShrink: 0 }}>
          <div onClick={() => setCbCollapsed(p => !p)} style={{ padding: '5px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
            <span style={{ fontFamily: "'Cinzel', serif", fontSize: '9px', letterSpacing: '2px', color: '#ff9050', textTransform: 'uppercase' }}>⚔ COMBAT</span>
            <span style={{ fontFamily: "'Cinzel', serif", fontSize: '8px', color: '#b8a878' }}>Round {g.combatRound} {cbCollapsed ? '▶' : '▼'}</span>
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

      {/* Battle map */}
      {g.inCombat && g.battleMap && (
        <div style={{ background: '#0f0d09', borderBottom: '1px solid #3a3020', flexShrink: 0 }}>
          <div onClick={() => setBmCollapsed(p => !p)} style={{ padding: '4px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
            <span style={{ fontFamily: "'Cinzel', serif", fontSize: '8px', letterSpacing: '2px', color: '#7a6840', textTransform: 'uppercase' }}>Carte tactique</span>
            <span style={{ fontFamily: "'Cinzel', serif", fontSize: '8px', color: '#3a3020' }}>{bmCollapsed ? '▶' : '▼'}</span>
          </div>
          {!bmCollapsed && (
            <div style={{ padding: '4px 12px 8px' }}>
              <pre style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '11px', color: '#e8d090', background: '#0f0d09', lineHeight: 1.25, whiteSpace: 'pre', overflowX: 'auto', letterSpacing: '1px' }}>{g.battleMap}</pre>
              {g.battleMapLegend && <div style={{ fontFamily: "'Cinzel', serif", fontSize: '9px', color: '#7a6840', marginTop: '4px' }}>{g.battleMapLegend}</div>}
            </div>
          )}
        </div>
      )}

      {/* Log */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ fontFamily: "'Cinzel', serif", fontSize: '7px', letterSpacing: '3px', textTransform: 'uppercase', color: '#7a6840', padding: '4px 12px', flexShrink: 0 }}>Chronique</div>
        <div ref={logEl} style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '6px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {log.map(msg => (
            <div key={msg.id} style={msgStyle(msg)}>
              {(msg.type === 'dm' || msg.type === 'pl') && (
                <span style={{ fontFamily: "'Cinzel', serif", fontSize: '7px', letterSpacing: '2px', textTransform: 'uppercase', color: msg.type === 'dm' ? '#7a6840' : '#2a6b3a', display: 'block', marginBottom: '2px' }}>
                  {msg.type === 'dm' ? 'Maître du Jeu' : g.char?.nm || 'Joueur'}
                </span>
              )}
              <span dangerouslySetInnerHTML={{ __html: msg.type === 'dm' || msg.type === 'pl' || msg.type === 'cbt' ? fmt(msg.text) : msg.text }} />
            </div>
          ))}
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 0' }}>
              <span style={{ fontFamily: "'Cinzel', serif", fontSize: '9px', color: '#7a6840' }}>Le MJ réfléchit</span>
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

      {/* Sheet button */}
      <button onClick={() => setShowSheet(true)} style={{ fontFamily: "'Cinzel', serif", fontSize: '10px', letterSpacing: '1px', padding: '8px', background: '#1a1610', border: 'none', borderTop: '1px solid #3a3020', color: '#b8a878', cursor: 'pointer', flexShrink: 0 }}>
        📋 Fiche · Inventaire · Sorts · Capacités
      </button>

      {/* Manual next turn button */}
      {showManualNext && !loading && (
        <button onClick={playAutoTurn} style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase', padding: '11px', background: '#7a4f0a', border: 'none', borderTop: '1px solid #c8820a', borderBottom: '1px solid #c8820a', color: '#fff', cursor: 'pointer', width: '100%', fontWeight: 600, flexShrink: 0 }}>
          ▶ Jouer le tour de {showManualNext.name}
        </button>
      )}

      {/* Dice row */}
      <div style={{ background: '#1a1610', borderTop: '1px solid #3a3020', padding: '8px 12px', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <div>
            <div style={{ fontFamily: "'Cinzel', serif", fontSize: '7px', letterSpacing: '2px', textTransform: 'uppercase', color: '#7a6840' }}>
              Dés{pendRoll ? ` — ${pendRoll.label}` : ''}
            </div>
            {pendRoll && <div style={{ fontSize: '10px', color: '#c9952a' }}>d{pendRoll.dice}{pendRoll.mod !== 0 ? (pendRoll.mod > 0 ? '+' : '') + pendRoll.mod : ''}{pendRoll.dc ? ` DD${pendRoll.dc}` : ''} ({pendRoll.modLabel})</div>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {[4, 6, 8, 10, 12, 20, 100].map(d => {
            const isReq = pendRoll?.dice === d
            return (
              <button key={d} onClick={() => rDie(d)} disabled={!isReq} style={{ flex: 1, fontFamily: "'Cinzel', serif", fontSize: '10px', padding: '7px 2px', background: isReq ? '#1e1912' : '#1e1912', border: `1px solid ${isReq ? '#c9952a' : '#3a3020'}`, color: isReq ? '#c9952a' : '#3a3020', cursor: isReq ? 'pointer' : 'not-allowed', borderRadius: '2px', fontWeight: isReq ? 600 : 400 }}>
                {d === 100 ? 'd%' : `d${d}`}
              </button>
            )
          })}
        </div>
      </div>

      {/* Input area */}
      <div style={{ background: '#1e1912', borderTop: '1px solid #3a3020', flexShrink: 0 }}>
        {pendRoll && (
          <div style={{ padding: '6px 12px', background: 'rgba(155,35,24,.1)', fontFamily: "'Cinzel', serif", fontSize: '9px', letterSpacing: '1px', color: '#ff8070', textAlign: 'center' }}>
            ⚠ LANCEZ LE DÉ REQUIS AVANT DE CONTINUER
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', padding: '6px 12px 4px' }}>
          {QA_TEXTS.map((t, i) => (
            <button key={i} onClick={() => { if (!pendRoll) { setInputText(t); setTimeout(sendMsg, 0) } }} disabled={!!pendRoll || inputLocked} style={{ fontFamily: "'Cinzel', serif", fontSize: '9px', padding: '4px 8px', background: '#241f17', border: '1px solid #3a3020', color: '#7a6840', cursor: 'pointer', borderRadius: '2px', opacity: (pendRoll || inputLocked) ? 0.4 : 1 }}>
              {['👁 Observer', '💬 Parler', '🔍 Fouiller', '⚔ Attaquer', '💤 Repos court', '📍 Situation'][i]}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '8px', padding: '4px 12px 10px', alignItems: 'flex-end' }}>
          <textarea
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg() } }}
            placeholder={inputLocked && !pendRoll ? (g.inCombat ? 'Attendez votre tour...' : 'Chargement...') : 'Décrivez votre action...'}
            disabled={inputLocked}
            rows={2}
            style={{ flex: 1, fontFamily: "'Crimson Pro', serif", fontSize: '14px', padding: '9px 10px', background: inputLocked ? '#16130d' : '#241f17', border: '1px solid #3a3020', color: '#f0ead8', outline: 'none', resize: 'none', WebkitAppearance: 'none', opacity: inputLocked ? 0.5 : 1 }}
          />
          <button onClick={sendMsg} disabled={inputLocked || loading} style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', padding: '10px 14px', background: '#2a6b3a', border: '2px solid #3d9954', color: '#fff', cursor: (inputLocked || loading) ? 'not-allowed' : 'pointer', opacity: (inputLocked || loading) ? 0.4 : 1, alignSelf: 'stretch' }}>
            Agir →
          </button>
        </div>
      </div>

      {/* Modals */}
      {showSheet && <SheetModal />}
      {showSaves && <SavesModal />}

      {/* Combat drawer (mobile) */}
      {showDrawer && (
        <>
          <div onClick={() => setShowDrawer(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 149 }} />
          <div style={{ position: 'fixed', top: 0, right: 0, width: '88%', maxWidth: '380px', height: '100vh', background: '#1a1610', borderLeft: '2px solid #c8392b', zIndex: 150, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '10px 14px', background: '#1e1912', borderBottom: '2px solid #c8392b', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <span style={{ fontFamily: "'Cinzel Decorative', cursive", fontSize: '14px', color: '#ff9050' }}>⚔ Combat</span>
              <button onClick={() => setShowDrawer(false)} style={{ fontFamily: "'Cinzel', serif", fontSize: '10px', letterSpacing: '1px', padding: '5px 10px', background: 'transparent', border: '1px solid #7a6840', color: '#7a6840', cursor: 'pointer', borderRadius: '2px' }}>✕ Fermer</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
              <div style={{ fontFamily: "'Cinzel', serif", fontSize: '8px', letterSpacing: '2px', color: '#ff9050', textTransform: 'uppercase', marginBottom: '6px', borderBottom: '1px solid #3a3020', paddingBottom: '3px' }}>Initiative · Round {g.combatRound}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '14px' }}>
                {g.initiative.map((t, i) => (
                  <div key={t.ref} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', background: i === g.currentTurn ? 'rgba(201,149,42,.1)' : 'transparent', border: `1px solid ${i === g.currentTurn ? '#c9952a' : '#3a3020'}` }}>
                    <span style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', color: '#7a6840', minWidth: '24px', textAlign: 'right' }}>{t.init}</span>
                    <span style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', color: t.dead ? '#3a3020' : t.isPlayer || t.isAlly ? '#80e090' : '#ff8070', textDecoration: t.dead ? 'line-through' : 'none' }}>
                      {i === g.currentTurn ? '▶ ' : ''}{t.name}{t.isAlly ? ' (allié)' : ''}{t.downed ? ' 🩸' : t.stabilized ? ' 💤' : ''}
                    </span>
                  </div>
                ))}
              </div>
              {g.battleMap && (
                <>
                  <div style={{ fontFamily: "'Cinzel', serif", fontSize: '8px', letterSpacing: '2px', color: '#ff9050', textTransform: 'uppercase', marginBottom: '6px', borderBottom: '1px solid #3a3020', paddingBottom: '3px' }}>Carte tactique</div>
                  <pre style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '11px', color: '#e8d090', background: '#0f0d09', padding: '8px', border: '1px solid #3a3020', lineHeight: 1.25, whiteSpace: 'pre', overflowX: 'auto', letterSpacing: '1px', marginBottom: '5px' }}>{g.battleMap}</pre>
                  <div style={{ fontFamily: "'Cinzel', serif", fontSize: '9px', color: '#7a6840' }}>{g.battleMapLegend}</div>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* Token detail modal */}
      {showTokenDetail && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }} onClick={() => setShowTokenDetail(false)}>
          <div style={{ background: '#1a1610', border: '1px solid #3a3020', padding: '16px', minWidth: '260px' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: "'Cinzel', serif", fontSize: '10px', letterSpacing: '2px', color: '#c9952a', textTransform: 'uppercase', marginBottom: '12px' }}>Consommation API</div>
            {[
              ['Appels', String(tokens.calls)],
              ['Entrée', `${tokens.input.toLocaleString()} tk`],
              ['Sortie', `${tokens.output.toLocaleString()} tk`],
              ['Cache créé', `${tokens.cacheCreate.toLocaleString()} tk`],
              ['Cache lu', `${tokens.cacheRead.toLocaleString()} tk`],
            ].map(([l, v]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px' }}>
                <span style={{ color: '#7a6840' }}>{l}</span>
                <span style={{ color: '#f0ead8', fontFamily: "'JetBrains Mono', monospace", fontSize: '11px' }}>{v}</span>
              </div>
            ))}
            <button onClick={() => setShowTokenDetail(false)} style={{ width: '100%', marginTop: '8px', fontFamily: "'Cinzel', serif", fontSize: '10px', padding: '8px', background: 'transparent', border: '1px solid #3a3020', color: '#7a6840', cursor: 'pointer' }}>✕ Fermer</button>
          </div>
        </div>
      )}

      {/* Toast */}
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
