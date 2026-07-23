import type { Character, DynamicStateForAPI } from '@/lib/types'
import type { Lang } from '@/lib/i18n/config'
import type { SpeciesData, ClassData, BackgroundData } from './srd-types'
import { RULES_EN } from './rules.en'
import { RULES_FR } from './rules.fr'
import { getSpecies, getClasses, getBackgrounds, ABILITY_LABELS } from './srd-data'

type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'
const ABILITY_ORDER: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha']

function abilityMod(v: number): number {
  return Math.floor((v - 10) / 2)
}

function fmtMod(m: number): string {
  return m >= 0 ? `+${m}` : `${m}`
}

function proficiencyBonus(level: number): number {
  return 2 + Math.floor((level - 1) / 4)
}

const HEADERS: Record<Lang, Record<string, string>> = {
  en: {
    sheet: 'CHARACTER SHEET', name: 'Name', pronouns: 'Pronouns', species: 'Species', class: 'Class', level: 'Level', background: 'Background',
    abilityScores: 'ABILITY SCORES', combatStats: 'COMBAT STATS', hp: 'HP', max: 'max', ac: 'AC', speed: 'Speed', ft: 'ft',
    pb: 'Proficiency Bonus', init: 'Initiative',
    acNote: 'includes all worn armor, shield, and class bonuses. Use this value exactly. Do not recalculate.',
    savingThrows: 'SAVING THROWS', skillProfs: 'SKILL PROFICIENCIES', profs: 'PROFICIENCIES',
    armor: 'Armor', weapons: 'Weapons', tools: 'Tools', equipment: 'EQUIPMENT',
    features: 'CLASS & SPECIES FEATURES', spells: 'SPELLS', cantrips: 'Cantrips', spellsKnown: 'Spells Known', spellSlots: 'Spell Slots',
    currentState: 'CURRENT CHARACTER STATE (updated every turn)', conditions: 'Conditions', none: 'none', inventory: 'Inventory', purse: 'Purse',
    activeCombat: 'ACTIVE COMBAT', round: 'Round', currentTurnLabel: 'Current turn', player: 'PLAYER', enemy: 'ENEMY', order: 'Order',
    sessionNotes: 'Session notes (resources used, etc.):', gp: 'gp',
    actionEconomy: 'Action economy (player, this round)', action: 'Action', bonusAction: 'Bonus action', movement: 'Movement', reaction: 'Reaction', used: 'used', available: 'available',
  },
  fr: {
    sheet: 'FICHE DE PERSONNAGE', name: 'Nom', pronouns: 'Pronoms', species: 'Espèce', class: 'Classe', level: 'Niveau', background: 'Historique',
    abilityScores: 'CARACTÉRISTIQUES', combatStats: 'STATS DE COMBAT', hp: 'PV', max: 'max', ac: 'CA', speed: 'Vitesse', ft: 'pieds',
    pb: 'Bonus de maîtrise', init: 'Initiative',
    acNote: 'inclut toute l\'armure portée, le bouclier et les bonus de classe. Utilise cette valeur telle quelle. Ne la recalcule pas.',
    savingThrows: 'JETS DE SAUVEGARDE', skillProfs: 'MAÎTRISES DE COMPÉTENCES', profs: 'MAÎTRISES',
    armor: 'Armures', weapons: 'Armes', tools: 'Outils', equipment: 'ÉQUIPEMENT',
    features: 'CAPACITÉS DE CLASSE ET D\'ESPÈCE', spells: 'SORTS', cantrips: 'Sorts mineurs', spellsKnown: 'Sorts connus', spellSlots: 'Emplacements de sorts',
    currentState: 'ÉTAT COURANT DU PERSONNAGE (mis à jour à chaque tour)', conditions: 'Conditions', none: 'aucune', inventory: 'Inventaire', purse: 'Bourse',
    activeCombat: 'COMBAT ACTIF', round: 'Round', currentTurnLabel: 'Tour actuel', player: 'JOUEUR', enemy: 'ENNEMI', order: 'Ordre',
    sessionNotes: 'Notes de session (ressources utilisées, etc.) :', gp: 'po',
    actionEconomy: 'Économie d\'actions (joueur, ce round)', action: 'Action', bonusAction: 'Action bonus', movement: 'Déplacement', reaction: 'Réaction', used: 'utilisée', available: 'disponible',
  },
}

function formatCharacterSheet(character: Character, lang: Lang): string {
  const h = HEADERS[lang]
  const al = ABILITY_LABELS[lang]
  const speciesMap = getSpecies(lang) as Record<string, SpeciesData>
  const classMap = getClasses(lang) as Record<string, ClassData>
  const backgroundMap = getBackgrounds(lang) as Record<string, BackgroundData>

  const species = speciesMap[character.species]
  const speciesName = species?.name || character.species
  const subraceName = character.subrace && species?.subraces ? species.subraces[character.subrace]?.name : undefined

  const cls = classMap[character.class]
  const className = cls?.name || character.class
  const subclassName = character.subclass && cls?.subclass_at_1
    ? cls.subclass_at_1.options.find(o => o.id === character.subclass)?.name
    : undefined

  const bg = backgroundMap[character.background]
  const bgName = bg?.name || character.background

  const pb = proficiencyBonus(character.level)
  const mods: Record<AbilityKey, number> = {
    str: abilityMod(character.str), dex: abilityMod(character.dex), con: abilityMod(character.con),
    int: abilityMod(character.int), wis: abilityMod(character.wis), cha: abilityMod(character.cha),
  }

  const lines: string[] = []
  lines.push(`=== ${h.sheet} ===`)
  lines.push(`${h.name}: ${character.name}`)
  if (character.pronouns) lines.push(`${h.pronouns}: ${character.pronouns}`)
  lines.push(`${h.species}: ${speciesName}${subraceName ? ` (${subraceName})` : ''}`)
  lines.push(`${h.class}: ${className}${subclassName ? ` – ${subclassName}` : ''} (${h.level} ${character.level})`)
  lines.push(`${h.background}: ${bgName}`)
  lines.push('')
  lines.push(h.abilityScores)
  lines.push(ABILITY_ORDER.slice(0, 3).map(k => `${al[k]} ${character[k]} (${fmtMod(mods[k])})`).join(' | '))
  lines.push(ABILITY_ORDER.slice(3).map(k => `${al[k]} ${character[k]} (${fmtMod(mods[k])})`).join(' | '))
  lines.push('')
  lines.push(h.combatStats)
  lines.push(`${h.hp}: ${character.hp_max} (${h.max}) | ${h.ac}: ${character.ac} | ${h.speed}: ${character.speed} ${h.ft}`)
  lines.push(`${h.ac}: ${character.ac} — ${h.acNote}`)
  lines.push(`${h.pb}: +${pb} | ${h.init}: ${fmtMod(mods.dex)}`)
  lines.push('')
  lines.push(h.savingThrows)
  lines.push(ABILITY_ORDER.map(k => {
    const isProf = character.saving_throw_profs.includes(k)
    const bonus = mods[k] + (isProf ? pb : 0)
    return `${al[k]} ${fmtMod(bonus)}${isProf ? '*' : ''}`
  }).join(' | '))
  lines.push('')
  lines.push(h.skillProfs)
  lines.push(character.skill_profs.join(', ') || h.none)
  lines.push('')
  lines.push(h.profs)
  lines.push(`${h.armor}: ${character.armor_profs.join(', ') || h.none}`)
  lines.push(`${h.weapons}: ${character.weapon_profs.join(', ') || h.none}`)
  lines.push(`${h.tools}: ${character.tool_profs.join(', ') || h.none}`)
  lines.push('')
  lines.push(h.equipment)
  character.equipment.forEach(item => {
    lines.push(`- ${item.quantity > 1 ? `${item.quantity}x ` : ''}${item.name}${item.notes ? ` — ${item.notes}` : ''}`)
  })
  lines.push('')
  lines.push(h.features)
  character.features.forEach(f => {
    const recharge = f.recharge ? ` (${f.uses ? `${f.uses}x, ` : ''}${f.recharge})` : ''
    lines.push(`- ${f.name}: ${f.description}${recharge}`)
  })

  if (character.cantrips?.length || character.spells_known?.length) {
    lines.push('')
    lines.push(h.spells)
    if (character.cantrips?.length) lines.push(`${h.cantrips}: ${character.cantrips.join(', ')}`)
    if (character.spells_known?.length) lines.push(`${h.spellsKnown}: ${character.spells_known.join(', ')}`)
    if (character.spell_slots) {
      const slotLines = Object.entries(character.spell_slots).map(([lvl, n]) => `L${lvl}: ${n}`).join(' · ')
      lines.push(`${h.spellSlots}: ${slotLines}`)
    }
  }

  return lines.join('\n')
}

function formatDynamicState(state: DynamicStateForAPI, character: Character, lang: Lang): string {
  const h = HEADERS[lang]
  const lines: string[] = []
  lines.push(`=== ${h.currentState} ===`)
  lines.push(`${character.name} | ${h.hp}: ${state.hp}/${state.hpMax} | ${h.ac}: ${character.ac}`)

  if (character.spell_slots) {
    const slotLine = Object.entries(character.spell_slots).map(([lvl, total]) => {
      const used = state.spUsed[Number(lvl)] || 0
      return `L${lvl}: ${total - used}/${total}`
    }).join(' · ')
    lines.push(`${h.spellSlots}: ${slotLine}`)
  }

  lines.push(`${h.conditions}: ${state.conds.join(', ') || h.none}`)
  lines.push(`${h.inventory}: ${state.inv.slice(0, 12).join(', ') || h.none}`)
  lines.push(`${h.purse}: ${state.gold} ${h.gp}`)

  if (state.inCombat && state.initiative.length > 0) {
    const curr = state.initiative[state.currentTurn]
    lines.push('')
    lines.push(`=== ${h.activeCombat} ===`)
    lines.push(`${h.round} ${state.combatRound} | ${h.currentTurnLabel}: ${curr ? curr.name : '?'}${curr ? (curr.isPlayer ? ` (${h.player})` : ` (${h.enemy})`) : ''}`)
    lines.push(`${h.order}: ${state.initiative.filter(t => t.alive).map(t => `${t.name}(${t.init})`).join(' > ')}`)
    if (state.roundActions) {
      const ra = state.roundActions
      lines.push(`${h.actionEconomy}: ${h.action}=${ra.actionUsed ? h.used : h.available} | ${h.bonusAction}=${ra.bonusActionUsed ? h.used : h.available} | ${h.movement}=${ra.movementUsed}/${character.speed} ${h.ft} | ${h.reaction}=${ra.reactionUsed ? h.used : h.available}`)
    }
  }

  if (state.notes) {
    lines.push('')
    lines.push(`${h.sessionNotes}\n${state.notes}`)
  }

  return lines.join('\n')
}

export function buildSys(
  character: Character,
  dynamicState: DynamicStateForAPI,
  lang: Lang,
  campaignContext?: unknown // reserved — campaign progression brief extends this
): { staticPart: string; dynamicPart: string } {
  void campaignContext
  const rules = lang === 'fr' ? RULES_FR : RULES_EN
  const sheet = formatCharacterSheet(character, lang)
  const staticPart = `${rules}\n\n${sheet}`
  const dynamicPart = formatDynamicState(dynamicState, character, lang)
  return { staticPart, dynamicPart }
}
