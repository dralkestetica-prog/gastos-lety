function Pulse({ className }) {
  return <div className={`animate-pulse rounded-xl bg-gray-200 ${className}`} />
}

export function SkeletonTransaction() {
  return (
    <div className="bg-white rounded-2xl px-3 py-3 flex items-center gap-3">
      <Pulse className="w-10 h-10 rounded-xl shrink-0" />
      <div className="flex-1 space-y-2">
        <Pulse className="h-3.5 w-3/4" />
        <Pulse className="h-3 w-1/2" />
      </div>
      <Pulse className="h-4 w-16 rounded-lg" />
    </div>
  )
}

export function SkeletonSummaryCards() {
  return (
    <div className="grid grid-cols-3 gap-2 mb-4">
      {[0, 1, 2].map(i => (
        <div key={i} className="bg-white rounded-2xl p-3 space-y-2">
          <Pulse className="h-3 w-10 mx-auto" />
          <Pulse className="h-5 w-16 mx-auto" />
        </div>
      ))}
    </div>
  )
}

export function SkeletonCard({ lines = 2 }) {
  return (
    <div className="bg-white rounded-2xl px-4 py-4 space-y-3">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="flex justify-between items-center">
          <Pulse className={`h-3.5 ${i % 2 === 0 ? 'w-1/3' : 'w-1/4'}`} />
          <Pulse className="h-4 w-20 rounded-lg" />
        </div>
      ))}
    </div>
  )
}

export function SkeletonList({ count = 5 }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonTransaction key={i} />
      ))}
    </div>
  )
}
