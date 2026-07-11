import clsx from 'clsx'

type RelayLogoProps = {
  theme?: 'dark' | 'light'
  size?: 'sm' | 'md' | 'lg'
  showWordmark?: boolean
  className?: string
}

const sizeMap = {
  sm: {
    wrap: 'w-9 h-9 rounded-xl',
    wave: 'w-5 h-5',
    word: 'text-xl',
  },
  md: {
    wrap: 'w-11 h-11 rounded-2xl',
    wave: 'w-6 h-6',
    word: 'text-2xl',
  },
  lg: {
    wrap: 'w-16 h-16 rounded-2xl',
    wave: 'w-9 h-9',
    word: 'text-5xl',
  },
}

export default function RelayLogo({ theme = 'dark', size = 'md', showWordmark = true, className }: RelayLogoProps) {
  const s = sizeMap[size]
  const isLight = theme === 'light'

  return (
    <div className={clsx('inline-flex items-center gap-3', className)}>
      <div
        className={clsx(
          'relative flex items-center justify-center shadow-[0_16px_35px_-20px_rgba(95,99,255,0.9)]',
          s.wrap
        )}
        style={{
          background: isLight
            ? 'linear-gradient(140deg, #7e78ff 0%, #5c8cff 100%)'
            : 'linear-gradient(140deg, #8d63ff 0%, #4c78ff 100%)',
        }}
      >
        <svg
          viewBox="0 0 24 24"
          className={clsx(s.wave, 'text-white')}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden
        >
          <path
            d="M3 8C4.6 6.5 6.2 6.5 7.8 8C9.4 9.5 11 9.5 12.6 8C14.2 6.5 15.8 6.5 17.4 8C19 9.5 20.6 9.5 22 8"
            stroke="currentColor"
            strokeWidth="2.3"
            strokeLinecap="round"
          />
          <path
            d="M3 13C4.6 11.5 6.2 11.5 7.8 13C9.4 14.5 11 14.5 12.6 13C14.2 11.5 15.8 11.5 17.4 13C19 14.5 20.6 14.5 22 13"
            stroke="currentColor"
            strokeWidth="2.3"
            strokeLinecap="round"
            opacity="0.95"
          />
          <path
            d="M3 18C4.6 16.5 6.2 16.5 7.8 18C9.4 19.5 11 19.5 12.6 18C14.2 16.5 15.8 16.5 17.4 18C19 19.5 20.6 19.5 22 18"
            stroke="currentColor"
            strokeWidth="2.3"
            strokeLinecap="round"
            opacity="0.9"
          />
        </svg>
      </div>

      {showWordmark ? (
        <span
          className={clsx(
            'relay-wordmark font-extrabold tracking-tight leading-none',
            s.word,
            isLight ? 'text-slate-900' : 'text-white'
          )}
        >
          Relay
        </span>
      ) : null}
    </div>
  )
}
