import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Pocket GM — D&D 2024',
  description: 'Maître du Jeu solo pour D&D 2024, propulsé par Claude.',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className="h-full">
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
