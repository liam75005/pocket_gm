'use client'
import { useRef, useEffect, useCallback, useMemo } from 'react'
import type { BattleMap, MapToken } from '@/lib/types'
import { getReachableSquares } from '@/lib/game/movement'

const CELL = 44  // px per grid square
const COLORS = {
  floor:     '#f5f0e8',
  wall:      '#3a3330',
  tree:      '#4a7c59',
  water:     '#4a90b8',
  door_open: '#c4a35a',
  door_shut: '#7a5c2e',
  elevated:  '#d4c9a8',
  steps:     '#b8a878',
  grid_line: '#d4cfc8',
  move_range:'rgba(59, 130, 246, 0.25)',
  move_hover:'rgba(59, 130, 246, 0.45)',
}

const TOKEN_COLORS = {
  player:  { fill: '#3b82f6', text: '#ffffff' },
  enemy:   { fill: '#ef4444', text: '#ffffff' },
  ally:    { fill: '#22c55e', text: '#ffffff' },
  neutral: { fill: '#94a3b8', text: '#ffffff' },
}

const CONDITION_COLORS = {
  healthy:  '#22c55e',
  bloodied: '#eab308',
  hurt:     '#f97316',
  critical: '#ef4444',
  defeated: '#6b7280',
}

interface Props {
  battleMap: BattleMap
  playerSpeed: number         // e.g. 30
  isPlayerTurn: boolean
  onMove: (x: number, y: number) => void
  onTargetEnemy: (token: MapToken) => void
}

export function BattleMapCanvas({
  battleMap, playerSpeed, isPlayerTurn, onMove, onTargetEnemy
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hoverRef = useRef<{ x: number; y: number } | null>(null)

  const terrain = battleMap.grid.split('\n').map(r => r.split(''))
  const playerToken = battleMap.tokens.find(t => t.type === 'player')

  const reachable = useMemo(() => (
    isPlayerTurn && playerToken
      ? getReachableSquares(battleMap.grid, playerToken.x, playerToken.y, playerSpeed, battleMap.tokens)
      : new Set<string>()
  ), [isPlayerTurn, playerToken, battleMap.grid, battleMap.tokens, playerSpeed])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Draw terrain
    for (let row = 0; row < battleMap.height; row++) {
      for (let col = 0; col < battleMap.width; col++) {
        const char = terrain[row]?.[col] ?? '.'
        const key = `${col},${row}`

        let fillColor = COLORS.floor
        if (char === '#' || char === 'T') fillColor = char === '#' ? COLORS.wall : COLORS.tree
        else if (char === '~') fillColor = COLORS.water
        else if (char === 'D') fillColor = COLORS.door_open
        else if (char === 'X') fillColor = COLORS.door_shut
        else if (char === '^') fillColor = COLORS.elevated
        else if (char === 's') fillColor = COLORS.steps

        ctx.fillStyle = fillColor
        ctx.fillRect(col * CELL, row * CELL, CELL, CELL)

        // Movement range highlight
        if (reachable.has(key)) {
          const isHovered = hoverRef.current?.x === col && hoverRef.current?.y === row
          ctx.fillStyle = isHovered ? COLORS.move_hover : COLORS.move_range
          ctx.fillRect(col * CELL, row * CELL, CELL, CELL)
        }

        // Grid lines
        ctx.strokeStyle = COLORS.grid_line
        ctx.lineWidth = 0.5
        ctx.strokeRect(col * CELL, row * CELL, CELL, CELL)
      }
    }

    // Draw tokens
    for (const token of battleMap.tokens) {
      if (token.condition === 'defeated') continue

      const cx = token.x * CELL + CELL / 2
      const cy = token.y * CELL + CELL / 2
      const r = CELL * 0.38
      const colors = TOKEN_COLORS[token.type]

      // Active turn ring
      if (token.is_active) {
        ctx.strokeStyle = '#c9952a'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(cx, cy, r + 4, 0, Math.PI * 2)
        ctx.stroke()
      }

      // Token circle
      ctx.fillStyle = colors.fill
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fill()

      // Label
      ctx.fillStyle = colors.text
      ctx.font = `bold ${Math.floor(CELL * 0.28)}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(token.label.slice(0, 3), cx, cy)

      // Condition dot (enemies) or HP bar (player/ally)
      if (token.type === 'enemy' && token.condition) {
        const dotR = 5
        ctx.fillStyle = CONDITION_COLORS[token.condition]
        ctx.beginPath()
        ctx.arc(cx, token.y * CELL + CELL - 8, dotR, 0, Math.PI * 2)
        ctx.fill()
      } else if ((token.type === 'player' || token.type === 'ally') && token.hp !== undefined && token.hp_max) {
        const barW = CELL * 0.7
        const barH = 4
        const barX = cx - barW / 2
        const barY = token.y * CELL + CELL - 8
        const pct = Math.max(0, token.hp / token.hp_max)
        ctx.fillStyle = '#374151'
        ctx.fillRect(barX, barY, barW, barH)
        ctx.fillStyle = pct > 0.5 ? '#22c55e' : pct > 0.25 ? '#f97316' : '#ef4444'
        ctx.fillRect(barX, barY, barW * pct, barH)
      }

      // Status effect indicators (small icons top-right of token)
      if (token.status_effects?.length) {
        ctx.fillStyle = '#7c3aed'
        ctx.font = `${Math.floor(CELL * 0.22)}px sans-serif`
        ctx.textAlign = 'left'
        ctx.fillText('●'.repeat(Math.min(token.status_effects.length, 3)),
          token.x * CELL + CELL * 0.55, token.y * CELL + CELL * 0.2)
      }
    }
  }, [battleMap, reachable, terrain])

  useEffect(() => { draw() }, [draw])

  const getCellFromEvent = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return {
      x: Math.floor((e.clientX - rect.left) / CELL),
      y: Math.floor((e.clientY - rect.top) / CELL),
    }
  }

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCellFromEvent(e)
    // Check if clicked on an enemy token
    const enemyToken = battleMap.tokens.find(
      t => t.x === x && t.y === y && t.type === 'enemy' && t.condition !== 'defeated'
    )
    if (enemyToken) { onTargetEnemy(enemyToken); return }
    // Check if it's a reachable square
    if (reachable.has(`${x},${y}`)) { onMove(x, y) }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    hoverRef.current = getCellFromEvent(e)
    draw()
  }

  const handleMouseLeave = () => {
    hoverRef.current = null
    draw()
  }

  return (
    <canvas
      ref={canvasRef}
      width={battleMap.width * CELL}
      height={battleMap.height * CELL}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ border: '1px solid #3a3020', borderRadius: '2px', cursor: 'crosshair', maxWidth: '100%', imageRendering: 'pixelated' }}
    />
  )
}
