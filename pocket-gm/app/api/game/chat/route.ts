import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildSys } from '@/lib/game/buildSys'
import Anthropic from '@anthropic-ai/sdk'
import type { DynamicStateForAPI, Character } from '@/lib/types'
import { isLang, DEFAULT_LOCALE } from '@/lib/i18n/config'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { messages, characterId, dynamicState, lang: langParam } = await request.json() as {
    messages: { role: 'user' | 'assistant'; content: string }[]
    characterId: string
    dynamicState: DynamicStateForAPI
    lang?: string
  }

  const lang = langParam && isLang(langParam) ? langParam : DEFAULT_LOCALE

  const { data: character, error } = await supabase
    .from('characters')
    .select('*')
    .eq('id', characterId)
    .eq('user_id', user.id)
    .single()

  if (error || !character) return NextResponse.json({ error: 'Character not found' }, { status: 404 })

  const { staticPart, dynamicPart } = buildSys(character as Character, dynamicState, lang)

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
