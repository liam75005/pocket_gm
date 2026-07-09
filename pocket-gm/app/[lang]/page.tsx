import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isLang, DEFAULT_LOCALE } from '@/lib/i18n/config'

export const dynamic = 'force-dynamic'

export default async function RootPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: rawLang } = await params
  const lang = isLang(rawLang) ? rawLang : DEFAULT_LOCALE
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  redirect(user ? `/${lang}/play` : `/${lang}/login`)
}
