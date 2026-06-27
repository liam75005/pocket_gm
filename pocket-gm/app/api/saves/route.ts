import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const slot = request.nextUrl.searchParams.get('slot')
  let query = supabase.from('saves').select('*').eq('user_id', user.id)
  if (slot !== null) query = query.eq('slot', parseInt(slot))

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ saves: data })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { slot, characterId, state, logHtml, turnCount } = await request.json()

  const { error } = await supabase.from('saves').upsert({
    user_id: user.id,
    slot,
    character_id: characterId,
    state,
    log_html: logHtml,
    turn_count: turnCount,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,slot' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const slot = parseInt(request.nextUrl.searchParams.get('slot') || '0')
  const { error } = await supabase.from('saves')
    .delete().eq('user_id', user.id).eq('slot', slot)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
