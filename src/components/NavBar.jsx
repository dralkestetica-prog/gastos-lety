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
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex z-40 safe-area-inset-bottom">
      {items.map(({ id, label, Icon }) => (
        <button
          key={id}
          onClick={() => setTab(id)}
          className={`flex-1 flex flex-col items-center py-3 gap-0.5 text-xs font-medium transition-colors ${
            tab === id ? 'text-brand-600' : 'text-gray-400'
          }`}
        >
          <Icon size={20} />
          {label}
        </button>
      ))}
    </nav>
  )
}
