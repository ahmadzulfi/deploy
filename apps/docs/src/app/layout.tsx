import { RootProvider } from 'fumadocs-ui/provider/next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import type { Metadata } from 'next'
import './global.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: { default: 'wa-platform', template: '%s — wa-platform' },
  description: 'Referensi Public API wa-platform: kirim pesan WhatsApp, kelola kontak, picu flow, webhook keluar.',
}

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="id" className={`${inter.variable} ${mono.variable} ${inter.className}`} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  )
}
