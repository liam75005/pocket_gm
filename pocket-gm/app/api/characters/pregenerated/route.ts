import { NextRequest, NextResponse } from 'next/server'
import { getPregens } from '@/lib/game/pregens'
import { isLang, DEFAULT_LOCALE } from '@/lib/i18n/config'

export async function GET(request: NextRequest) {
  const langParam = request.nextUrl.searchParams.get('lang') || DEFAULT_LOCALE
  const lang = isLang(langParam) ? langParam : DEFAULT_LOCALE
  return NextResponse.json({ characters: getPregens(lang) })
}
