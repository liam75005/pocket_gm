'use client'

import { useParams } from 'next/navigation'
import { isLang, DEFAULT_LOCALE, type Lang } from './config'

export function useLang(): Lang {
  const params = useParams<{ lang: string }>()
  const raw = params?.lang
  return raw && isLang(raw) ? raw : DEFAULT_LOCALE
}
