// Roll 4d6, drop lowest, return sum
export function rollAbilityScore(): number {
  const rolls = Array.from({ length: 4 }, () => Math.ceil(Math.random() * 6))
  rolls.sort((a, b) => a - b)
  return rolls.slice(1).reduce((a, b) => a + b, 0)
}

// Roll a full set of 6 ability scores
export function rollAbilityScoreSet(): number[] {
  return Array.from({ length: 6 }, rollAbilityScore)
}

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8]
