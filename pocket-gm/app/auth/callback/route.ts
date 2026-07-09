import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { isLang, DEFAULT_LOCALE } from '@/lib/i18n/config'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const langParam = searchParams.get('lang')
  const lang = langParam && isLang(langParam) ? langParam : DEFAULT_LOCALE

  if (code) {
    const response = NextResponse.redirect(`${origin}/${lang}/play`)

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              response.cookies.set(name, value, options)
            })
          },
        },
      }
    )

    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return response
  }

  return NextResponse.redirect(`${origin}/${lang}/login?error=auth_callback_error`)
}
