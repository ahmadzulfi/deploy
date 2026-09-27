'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { THEME_KEY } from '@/lib/theme'

type Theme = 'system' | 'light' | 'dark'

const OPTIONS: { value: Theme; label: string; icon: () => React.JSX.Element }[] = [
  { value: 'light', label: 'Terang', icon: IconSun },
  { value: 'dark', label: 'Gelap', icon: IconMoon },
  { value: 'system', label: 'Ikuti sistem', icon: IconMonitor },
]

function apply(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
  try {
    if (theme === 'system') localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, theme)
  } catch {
    // Private mode or blocked storage: the choice holds for this page only.
  }
}

/** Light / dark / follow the OS, remembered per browser. */
export function ThemeToggle() {
  // Unknown until mounted: the server cannot see localStorage.
  const [theme, setTheme] = useState<Theme | null>(null)

  useEffect(() => {
    const attr = document.documentElement.getAttribute('data-theme')
    setTheme(attr === 'light' || attr === 'dark' ? attr : 'system')
  }, [])

  return (
    <div role="radiogroup" aria-label="Tema tampilan" className="flex rounded-lg border bg-muted p-0.5">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          role="radio"
          aria-checked={theme === value}
          title={label}
          onClick={() => {
            apply(value)
            setTheme(value)
          }}
          className={cn(
            'flex size-6 items-center justify-center rounded-md transition-colors',
            theme === value ? 'bg-surface text-fg shadow-xs' : 'text-fg-muted hover:text-fg',
          )}
        >
          <Icon />
          <span className="sr-only">{label}</span>
        </button>
      ))}
    </div>
  )
}

// Outline icons, same stroke as the nav rail's.
const svg = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

function IconSun() {
  return (
    <svg {...svg}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </svg>
  )
}

function IconMoon() {
  return (
    <svg {...svg}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
    </svg>
  )
}

function IconMonitor() {
  return (
    <svg {...svg}>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path d="M9 20h6M12 16.5V20" />
    </svg>
  )
}
