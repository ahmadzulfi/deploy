import { IconBell, IconKey, IconMegaphone } from '@/components/ui/icons'

/** One icon per template category, shared by the list, the tabs and the wizard. */
export const CATEGORY_ICON: Record<string, (p: { size?: number; className?: string }) => React.ReactNode> = {
  MARKETING: IconMegaphone,
  UTILITY: IconBell,
  AUTHENTICATION: IconKey,
}
