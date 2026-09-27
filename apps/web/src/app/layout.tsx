import type { Metadata } from 'next'
import { THEME_KEY } from '@/lib/theme'
import './globals.css'

export const metadata: Metadata = {
  title: 'WhatsApp Platform',
  description: 'Inbox, flow, dan broadcast untuk banyak nomor WhatsApp Business',
}

/**
 * Applies the saved theme before the first paint. Without it the page would
 * render light, then flip to dark once React loads - a white flash on every
 * navigation for anyone using dark mode. "system" leaves the attribute off so
 * the CSS follows the OS setting on its own.
 */
const applyTheme = `try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The script above sets data-theme before React hydrates; that difference is expected.
    <html lang="id" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: applyTheme }} />
      </head>
      <body className="h-full">{children}</body>
    </html>
  )
}
