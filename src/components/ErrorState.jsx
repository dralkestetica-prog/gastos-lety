import { WifiOff } from 'lucide-react'

export default function ErrorState({ mensaje, onReintentar }) {
  return (
    <div className="flex flex-col items-center justify-center mt-20 gap-4 px-8 text-center">
      <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center">
        <WifiOff size={28} className="text-red-400" />
      </div>
      <div>
        <p className="font-semibold text-gray-700 text-base">Sin conexión</p>
        <p className="text-sm text-gray-400 mt-1">{mensaje || 'No se pudo conectar con el servidor.'}</p>
      </div>
      <button
        onClick={onReintentar}
        className="mt-2 px-5 py-2.5 bg-brand-600 text-white rounded-2xl text-sm font-medium active:scale-95 transition-all"
      >
        Reintentar
      </button>
    </div>
  )
}
