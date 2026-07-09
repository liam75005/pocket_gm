import type { Lang } from '@/lib/i18n/config'

export interface Campaign {
  id: string
  gameId: string
  name: Record<Lang, string>
  description: Record<Lang, string>
  levelRange: string
  sessions: Record<Lang, string>
  active: boolean
}

export const CAMPAIGNS: Campaign[] = [
  {
    id: 'five_oaks',
    gameId: 'dnd5e',
    name: {
      en: 'Five Oaks: The Nameless Forest',
      fr: 'Cinq Chênes : la Forêt sans Nom',
    },
    description: {
      en: 'A sandbox of 3 interlinked scenarios in and around a forest village plagued by something older than the trees.',
      fr: 'Un bac à sable de 3 scénarios liés entre eux, dans et autour d\'un village forestier hanté par quelque chose de plus ancien que les arbres.',
    },
    levelRange: '1–2',
    sessions: {
      en: '~3–5 sessions',
      fr: '~3 à 5 séances',
    },
    active: true,
  },
]
