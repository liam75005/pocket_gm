import type { Metadata } from 'next'
import { LOCALES, isLang, DEFAULT_LOCALE } from '@/lib/i18n/config'
import '../globals.css'

export const metadata: Metadata = {
  title: 'Pocket GM — D&D 2024',
  description: 'Solo AI Game Master for D&D 2024.',
}

export function generateStaticParams() {
  return LOCALES.map(lang => ({ lang }))
}

export default async function RootLayout({
  children,
  params,
}: Readonly<{ children: React.ReactNode; params: Promise<{ lang: string }> }>) {
  const { lang: rawLang } = await params
  const lang = isLang(rawLang) ? rawLang : DEFAULT_LOCALE

  return (
    <html lang={lang} className="h-full">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600&family=Cinzel+Decorative:wght@400&family=Crimson+Pro:ital,wght@0,400;0,600;1,400&family=JetBrains+Mono:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="h-full">{children}</body>
    </html>
  )
}
