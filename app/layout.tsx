import { StatLabProvider } from '@/components/StatLabProvider'
import './globals.css' // Keep your existing CSS import here

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-zinc-950 text-zinc-50 antialiased">
        <StatLabProvider>
          {children}
        </StatLabProvider>
      </body>
    </html>
  )
}