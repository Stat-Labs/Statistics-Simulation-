export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <div
      className="rounded-lg bg-emerald-500 flex items-center justify-center flex-shrink-0 shadow-sm"
      style={{ width: size, height: size }}
    >
      <svg
        className="text-zinc-950"
        style={{ width: size * 0.6, height: size * 0.6 }}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.5l5-5 4 4 5-6 4 3" />
      </svg>
    </div>
  )
}

export function Logo({
  size = 24,
  wordmark = 'StatLab',
  subtitle,
}: {
  size?: number
  wordmark?: string
  subtitle?: string
}) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={size} />
      <div className="leading-tight">
        <span className="font-semibold tracking-tight text-white">{wordmark}</span>
        {subtitle && (
          <div className="text-[10px] text-zinc-500 font-mono">{subtitle}</div>
        )}
      </div>
    </div>
  )
}
