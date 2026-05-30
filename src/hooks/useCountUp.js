import { useEffect, useState, useRef } from 'react'

export function useCountUp(target, duration = 700) {
  const [value, setValue] = useState(0)
  const prev = useRef(0)

  useEffect(() => {
    const from = prev.current
    prev.current = target
    if (from === target) return

    const start = performance.now()
    let raf

    function tick(now) {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(Math.round(from + (target - from) * eased))
      if (progress < 1) raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])

  return value
}
