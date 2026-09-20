import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'WhatsApp Platform',
  description: 'Inbox, flow, dan broadcast untuk banyak nomor WhatsApp Business',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="h-full">{children}</body>
    </html>
  )
}
