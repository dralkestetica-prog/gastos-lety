import { LayoutList, CreditCard, Search, BarChart2, Repeat, Moon, Sun } from 'lucide-react'

export default function NavBar({ tab, setTab, darkMode, toggleDark }) {
  const items = [
    { id: 'mes',     label: 'Mes',    Icon: LayoutList },
    { id: 'resumen', label: 'Stats',  Icon: BarChart2  },
    { id: 'fijos',   label: 'Fijos',  Icon: Repeat     },
    { id: 'buscar',  label: 'Buscar', Icon: Search     },
    { id: 'cuentas', label: 'Cuentas',Icon: CreditCard },
  ]
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex z-40 no-print" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
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
      <button
        onClick={toggleDark}
        className="w-12 flex flex-col items-center py-3 gap-0.5 text-xs font-medium text-gray-400 transition-colors hover:text-brand-600"
      >
        {darkMode ? <Sun size={20} /> : <Moon size={20} />}
        {darkMode ? 'Luz' : 'Dark'}
      </button>
    </nav>
  )
}
