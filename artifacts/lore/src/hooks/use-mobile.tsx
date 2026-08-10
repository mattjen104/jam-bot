import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  // Seed from the current viewport via the state initializer (runs once, in
  // render, not in an effect) so the first paint is already correct and the
  // effect only has to keep it in sync with later resize/media changes.
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(() => {
    if (typeof window === "undefined") return undefined
    return window.innerWidth < MOBILE_BREAKPOINT
  })

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
