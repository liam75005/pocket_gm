export interface PendingRoll {
  dice: number
  mod: number
  modLabel: string
  type: 'skill' | 'attack' | 'save' | 'damage' | 'death' | 'init'
  label: string
  dc: number | null
  advantage: 'advantage' | 'disadvantage' | null
}

export interface InitiativeEntry {
  name: string
  init: number
  isPlayer: boolean
  isAlly: boolean
  alive: boolean
  ref: string
  surprised?: boolean
  downed?: boolean
  stabilized?: boolean
  dead?: boolean
}

export interface TokenUsage {
  input: number
  output: number
  cacheCreate: number
  cacheRead: number
  calls: number
}

export interface GameState {
  hp: number
  hpMax: number
  conds: string[]
  inv: string[]
  gold: number
  notes: string
  spUsed: Record<number, number>
  dSucc: number
  dFail: number
  history: { role: 'user' | 'assistant'; content: string }[]
  pendRoll: PendingRoll | null
  inCombat: boolean
  combatRound: number
  initiative: InitiativeEntry[]
  currentTurn: number
  battleMap: string | null
  battleMapLegend: string
  awaitingReaction: boolean
  tokens: TokenUsage
}

export interface SaveSlot {
  id: string
  user_id: string
  slot: number
  character_id: string
  state: GameState
  log_html: string | null
  turn_count: number
  updated_at: string
}

export interface CharStat {
  FOR: number
  DEX: number
  CON: number
  INT: number
  SAG: number
  CHA: number
}

export interface CharSpell {
  ab: string
  dc: number
  att: string
  sl: Record<number, number>
  us: Record<number, number>
  cants: string[]
  prep: string[]
}

export interface Character {
  id: string
  nm: string
  sub: string
  background: string
  bgDesc: string
  bdg: string
  bt: string
  stats: CharStat
  hp: number
  hpMax: number
  ca: number
  init: string
  saves: { n: string; v: string; p?: number }[]
  skills: { n: string; v: string }[]
  bgFeat: string
  weaponMastery?: { n: string; mastery: string; desc: string }[]
  eq: string[]
  atk: { n: string; b: string; d: string; note?: string }[]
  feats: string[]
  sp: CharSpell | null
  ks: { l: string; v: string }[]
  desc: string
}

export interface DynamicStateForAPI {
  hp: number
  hpMax: number
  spUsed: Record<number, number>
  conds: string[]
  inv: string[]
  gold: number
  notes: string
  inCombat: boolean
  combatRound: number
  initiative: InitiativeEntry[]
  currentTurn: number
}
