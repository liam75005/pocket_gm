import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { LOCALES, DEFAULT_LOCALE, type Lang } from '@/lib/i18n/config'

function detectLocale(request: NextRequest): Lang {
  const cookieLocale = request.cookies.get('NEXT_LOCALE')?.value
  if (cookieLocale && (LOCALES as readonly string[]).includes(cookieLocale)) return cookieLocale as Lang

  const acceptLanguage = request.headers.get('accept-language') || ''
  for (const part of acceptLanguage.split(',')) {
    const code = part.trim().split(';')[0].split('-')[0]
    if ((LOCALES as readonly string[]).includes(code)) return code as Lang
  }
  return DEFAULT_LOCALE
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const pathnameHasLocale = LOCALES.some(
    locale => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`)
  )

  if (!pathnameHasLocale) {
    const locale = detectLocale(request)
    const url = request.nextUrl.clone()
    url.pathname = `/${locale}${pathname}`
    return NextResponse.redirect(url)
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options))
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const isProtected = /^\/(en|fr)\/(play|new-game)(\/|$)/.test(pathname)

  if (isProtected && !user) {
    const localeMatch = pathname.match(/^\/(en|fr)\//)
    const locale = localeMatch ? localeMatch[1] : DEFAULT_LOCALE
    const url = request.nextUrl.clone()
    url.pathname = `/${locale}/login`
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!api|auth|_next|favicon.ico).*)'],
}
