type RelayChatBubbleIconProps = {
  className?: string
  size?: number
  strokeWidth?: number
}

/**
 * Small chat bubble icon used in dashboard UI.
 * Uses currentColor so parent text classes control its color.
 */
export function RelayChatBubbleIcon({
  className,
  size = 16,
  strokeWidth = 2,
}: RelayChatBubbleIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M8 18.5L4.8 20.8L5.55 16.95C4.6 15.8 4 14.35 4 12.75C4 8.85 7.58 5.75 12 5.75C16.42 5.75 20 8.85 20 12.75C20 16.65 16.42 19.75 12 19.75C10.58 19.75 9.24 19.43 8 18.5Z"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="9" cy="12.75" r="1" fill="currentColor" />
      <circle cx="12" cy="12.75" r="1" fill="currentColor" />
      <circle cx="15" cy="12.75" r="1" fill="currentColor" />
    </svg>
  )
}

