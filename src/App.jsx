import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import NavBar from './components/NavBar'
import MesView from './pages/MesView'
import CuentasView from './pages/CuentasView'
import BuscadorView from './pages/BuscadorView'
import ResumenView from './pages/ResumenView'
import GastosFijosView from './pages/GastosFijosView'

export default function App() {
  const [tab, setTab] = useState('mes')
  const [categories, setCategories] = useState([])
  const [accounts, setAccounts] = useState([])
  const [cards, setCards] = useState([])
  const [ready, setReady] = useState(false)
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('darkMode') === 'true')

  useEffect(() => {
    if (darkMode) document.documentElement.classList.add('dark')
    else document.documentElement.classList.remove('dark')
    localStorage.setItem('darkMode', darkMode)
  }, [darkMode])

  useEffect(() => {
    async function init() {
      const [{ data: cats }, { data: accs }, { data: cds }] = await Promise.all([
        supabase.from('categories').select('id,name,icon,kind').order('kind'),
        supabase.from('accounts').select('id,name,type,currency,is_active').eq('is_active', true).order('display_order'),
        supabase.from('cards').select('id,name,brand').eq('is_active', true),
      ])
      setCategories(cats || [])
      setAccounts(accs || [])
      setCards(cds || [])
      setReady(true)
    }
    init()
  }, [])

  if (!ready) {
    return (
      <div className="min-h-screen bg-brand-600 flex flex-col items-center justify-center gap-4">
        <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center shadow-xl">
          <span className="text-4xl">💰</span>
        </div>
        <p className="text-white text-xl font-bold tracking-wide">Gastos Lety</p>
        <div className="flex gap-1.5 mt-2">
          {[0,1,2].map(i => (
            <div key={i} className="w-2 h-2 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {tab === 'mes'     && <MesView         categories={categories} accounts={accounts} cards={cards} />}
      {tab === 'resumen' && <ResumenView />}
      {tab === 'fijos'   && <GastosFijosView  categories={categories} accounts={accounts} cards={cards} />}
      {tab === 'buscar'  && <BuscadorView     categories={categories} accounts={accounts} cards={cards} />}
      {tab === 'cuentas' && <CuentasView accounts={accounts} cards={cards} categories={categories} />}
      <NavBar tab={tab} setTab={setTab} />
      {tab === 'cuentas' && (
        <button
          onClick={() => setDarkMode(d => !d)}
          className="fixed top-4 right-4 z-50 w-9 h-9 bg-white rounded-full shadow-md flex items-center justify-center text-gray-500 hover:text-brand-600 no-print"
        >
          {darkMode ? '☀️' : '🌙'}
        </button>
      )}
    </div>
  )
}
