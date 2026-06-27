import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildSys } from '@/lib/game/buildSys'
import Anthropic from '@anthropic-ai/sdk'
import type { DynamicStateForAPI } from '@/lib/types'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { messages, characterId, dynamicState } = await request.json() as {
    messages: { role: 'user' | 'assistant'; content: string }[]
    characterId: string
    dynamicState: DynamicStateForAPI
  }

  const { staticPart, dynamicPart } = buildSys(characterId, dynamicState)

  const response = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
    max_tokens: 1400,
    system: [
      { type: 'text', text: staticPart, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: dynamicPart },
    ],
    messages,
  })

  return NextResponse.json({
    content: (response.content[0] as { text: string }).text,
    usage: response.usage,
  })
}
