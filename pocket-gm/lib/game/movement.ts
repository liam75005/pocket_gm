import type { MapToken } from '@/lib/types'

export interface GridCell { x: number; y: number }

function parseTerrain(grid: string): string[][] {
  return grid.split('\n').map(row => row.split(''))
}

function moveCost(char: string): number {
  if ('#TX'.includes(char)) return Infinity   // impassable
  if ('~'.includes(char)) return 10            // difficult terrain
  return 5                                     // normal
}

export function getReachableSquares(
  grid: string,
  startX: number,
  startY: number,
  speedFt: number,
  tokens: MapToken[]
): Set<string> {
  const terrain = parseTerrain(grid)
  const height = terrain.length
  const width = terrain[0]?.length ?? 0

  // Squares occupied by other tokens (can't end movement there)
  const blocked = new Set(
    tokens
      .filter(t => !(t.x === startX && t.y === startY))
      .map(t => `${t.x},${t.y}`)
  )

  // BFS with cost tracking
  const visited = new Map<string, number>()  // key -> cost spent
  const queue: { x: number; y: number; cost: number }[] = [
    { x: startX, y: startY, cost: 0 }
  ]
  visited.set(`${startX},${startY}`, 0)

  const directions = [
    { dx: 0, dy: -1 }, { dx: 0, dy: 1 },
    { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
    // Diagonals (5e: first diagonal free, every other costs +5)
    { dx: -1, dy: -1 }, { dx: 1, dy: -1 },
    { dx: -1, dy: 1 },  { dx: 1, dy: 1 },
  ]

  while (queue.length > 0) {
    const current = queue.shift()!

    for (const { dx, dy } of directions) {
      const nx = current.x + dx
      const ny = current.y + dy
      const key = `${nx},${ny}`

      if (nx < 0 || ny < 0 || ny >= height || nx >= width) continue
      if (blocked.has(key)) continue

      const cell = terrain[ny][nx]
      const stepCost = moveCost(cell)
      if (stepCost === Infinity) continue

      // Diagonal movement: use 5-10-5 rule (every other diagonal costs 10)
      const isDiagonal = dx !== 0 && dy !== 0
      const actualCost = current.cost + (isDiagonal ? 7.5 : stepCost)
      // Simplified: treat all diagonals as 7.5 ft (rounds to 5/10 alternating)

      if (actualCost <= speedFt && (!visited.has(key) || visited.get(key)! > actualCost)) {
        visited.set(key, actualCost)
        queue.push({ x: nx, y: ny, cost: actualCost })
      }
    }
  }

  const reachable = new Set<string>()
  visited.forEach((_, key) => reachable.add(key))
  reachable.delete(`${startX},${startY}`)  // exclude starting square
  return reachable
}
