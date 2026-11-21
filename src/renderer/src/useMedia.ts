import { useEffect, useState } from 'react'

/** Phone-sized screens: settings go full screen, the top bar slims down. Keep in step with responsive.css. */
export const PHONE = '(max-width: 700px), (max-height: 500px) and (pointer: coarse)'

/** Whether a media query matches, kept up to date as the window resizes or the device rotates. */
export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const change = (): void => setOn(mq.matches)
    change()
    mq.addEventListener('change', change)
    return () => mq.removeEventListener('change', change)
  }, [query])
  return on
}
