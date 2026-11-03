import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'JobRadar — Global Remote Jobs',
  description: 'High-paying remote jobs from UAE, Europe, US, and more — ranked for India',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  )
}
