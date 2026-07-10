import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { Character } from '@/lib/types'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('characters')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ characters: data })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as Omit<Character, 'id' | 'user_id'>

  if (!body.name || !body.species || !body.class || !body.background) {
    return NextResponse.json({ error: 'Missing required character fields' }, { status: 400 })
  }

  const { data, error } = await supabase.from('characters').insert({
    user_id: user.id,
    name: body.name,
    pronouns: body.pronouns ?? null,
    species: body.species,
    subrace: body.subrace ?? null,
    class: body.class,
    subclass: body.subclass ?? null,
    background: body.background,
    level: body.level ?? 1,
    str: body.str, dex: body.dex, con: body.con, int: body.int, wis: body.wis, cha: body.cha,
    hp_max: body.hp_max, ac: body.ac, speed: body.speed,
    saving_throw_profs: body.saving_throw_profs ?? [],
    skill_profs: body.skill_profs ?? [],
    armor_profs: body.armor_profs ?? [],
    weapon_profs: body.weapon_profs ?? [],
    tool_profs: body.tool_profs ?? [],
    equipment: body.equipment ?? [],
    features: body.features ?? [],
    cantrips: body.cantrips ?? null,
    spells_known: body.spells_known ?? null,
    spell_slots: body.spell_slots ?? null,
    is_pregenerated: body.is_pregenerated ?? false,
    campaign: body.campaign ?? null,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ character: data })
}
