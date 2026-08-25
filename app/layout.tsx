import type { Metadata } from 'next'
import { StatLabProvider } from '@/components/StatLabProvider'
import { AuthProvider } from '@/components/AuthProvider'
import './globals.css'

export const metadata: Metadata = {
  title: 'StatLab — Your AI Data Scientist',
  description:
    'Upload a dataset and get instant statistical analysis, machine learning, forecasting and plain-English insights — powered by AI.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-zinc-950 text-zinc-50 antialiased">
        <AuthProvider>
          <StatLabProvider>
            {children}
          </StatLabProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
