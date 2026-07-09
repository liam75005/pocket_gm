import type { EquipmentItem } from '@/lib/types'

export const PROFICIENCY_BONUS_L1 = 2

export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2)
}

export function formatMod(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`
}

interface ArmorEntry { match: string; base: number; dexCap: number | null }

// Ordered most-specific match first (e.g. "studded leather armor" before "leather armor").
const ARMOR_TABLE: ArmorEntry[] = [
  { match: 'studded leather armor', base: 12, dexCap: null },
  { match: 'padded armor', base: 11, dexCap: null },
  { match: 'leather armor', base: 11, dexCap: null },
  { match: 'hide armor', base: 12, dexCap: 2 },
  { match: 'chain shirt', base: 13, dexCap: 2 },
  { match: 'scale mail', base: 14, dexCap: 2 },
  { match: 'breastplate', base: 14, dexCap: 2 },
  { match: 'half plate armor', base: 15, dexCap: 2 },
  { match: 'ring mail', base: 14, dexCap: 0 },
  { match: 'chain mail', base: 16, dexCap: 0 },
  { match: 'splint armor', base: 17, dexCap: 0 },
  { match: 'plate armor', base: 18, dexCap: 0 },
]

// Barbarian/Monk unarmored defense is only used when no armor item is equipped.
export function computeAC(classId: string, equipmentNames: string[], dexMod: number, conMod: number, wisMod: number): number {
  const lower = equipmentNames.map(n => n.toLowerCase())
  const hasShield = lower.some(n => n.includes('shield'))
  const armor = ARMOR_TABLE.find(a => lower.some(n => n.includes(a.match)))

  if (!armor) {
    if (classId === 'barbarian') return 10 + dexMod + conMod + (hasShield ? 2 : 0)
    if (classId === 'monk') return 10 + dexMod + wisMod
    return 10 + dexMod + (hasShield ? 2 : 0)
  }

  const dexBonus = armor.dexCap === 0 ? 0 : armor.dexCap === null ? dexMod : Math.min(dexMod, armor.dexCap)
  return armor.base + dexBonus + (hasShield ? 2 : 0)
}

export function computeHp(hitDie: number, conMod: number): number {
  return hitDie + conMod
}

export function computeSpellDC(spellAbilityMod: number): number {
  return 8 + PROFICIENCY_BONUS_L1 + spellAbilityMod
}

export function computeSpellAttackBonus(spellAbilityMod: number): number {
  return PROFICIENCY_BONUS_L1 + spellAbilityMod
}

export function savingThrowBonus(score: number, isProficient: boolean): number {
  return abilityMod(score) + (isProficient ? PROFICIENCY_BONUS_L1 : 0)
}

export function skillBonus(abilityScore: number, isProficient: boolean): number {
  return abilityMod(abilityScore) + (isProficient ? PROFICIENCY_BONUS_L1 : 0)
}

const GOLD_RE = /^(\d+)\s*gp$/i
const QTY_RE = /^(\d+)\s+(.+)$/

// Turns raw SRD equipment-kit strings ("Longsword", "20 arrows", "10 gp") into
// EquipmentItem entries. Gold entries are normalized to a consistent "Gold Pieces"
// name so callers can sum starting gold without re-parsing free text.
export function parseEquipmentList(items: string[]): EquipmentItem[] {
  return items.map(raw => {
    const goldMatch = raw.match(GOLD_RE)
    if (goldMatch) return { name: 'Gold Pieces', quantity: parseInt(goldMatch[1], 10) }
    const qtyMatch = raw.match(QTY_RE)
    if (qtyMatch) return { name: qtyMatch[2], quantity: parseInt(qtyMatch[1], 10) }
    return { name: raw, quantity: 1 }
  })
}
