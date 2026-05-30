import { LayoutList, CreditCard, Search, BarChart2, Repeat } from 'lucide-react'

export default function NavBar({ tab, setTab }) {
  const items = [
    { id: 'mes',     label: 'Mes',    Icon: LayoutList },
    { id: 'resumen', label: 'Stats',  Icon: BarChart2  },
    { id: 'fijos',   label: 'Fijos',  Icon: Repeat     },
    { id: 'buscar',  label: 'Buscar', Icon: Search     },
    { id: 'cuentas', label: 'Cuentas',Icon: CreditCard },
  ]

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 flex z-40 no-print border-t border-pink-100/80"
      style={{
        paddingBottom: 'env(safe-area-inset-bottom)',
        background: 'rgba(253, 242, 248, 0.92)',
        backdropFilter: 'blur(24px) saturate(200%)',
        WebkitBackdropFilter: 'blur(24px) saturate(200%)',
      }}
    >
      {items.map(({ id, label, Icon }) => {
        const active = tab === id
        return (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="flex-1 flex flex-col items-center py-2.5 gap-0.5 relative transition-all active:scale-95"
          >
            <div className={`p-1.5 rounded-xl transition-all duration-200 ${active ? 'bg-brand-100' : ''}`}>
              <Icon
                size={20}
                className={`transition-colors duration-200 ${active ? 'text-brand-600' : 'text-gray-400'}`}
                strokeWidth={active ? 2.5 : 1.8}
              />
            </div>
            <span className={`text-[10px] font-medium transition-colors duration-200 ${active ? 'text-brand-600' : 'text-gray-400'}`}>
              {label}
            </span>
            {active && (
              <span className="absolute top-0 left-1/2 -translate-x-1/2 w-5 h-0.5 bg-brand-600 rounded-full" />
            )}
          </button>
        )
      })}
    </nav>
  )
}
