import type { Lang } from '@/lib/i18n/config'

export interface GameSystem {
  id: string
  name: string
  tagline: Record<Lang, string>
  active: boolean
}

export const GAMES: GameSystem[] = [
  {
    id: 'dnd5e',
    name: 'D&D 5.2 SRD',
    tagline: {
      en: 'Dungeons & Dragons, 2024 rules (SRD 5.2)',
      fr: 'Donjons & Dragons, règles 2024 (SRD 5.2)',
    },
    active: true,
  },
  {
    id: 'coc',
    name: 'Call of Cthulhu',
    tagline: {
      en: 'Coming soon',
      fr: 'Bientôt disponible',
    },
    active: false,
  },
  {
    id: 'pathfinder',
    name: 'Pathfinder',
    tagline: {
      en: 'Coming soon',
      fr: 'Bientôt disponible',
    },
    active: false,
  },
]
