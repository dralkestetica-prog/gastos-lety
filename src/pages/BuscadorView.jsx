import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtARS, fmtUSD } from '../lib/formato'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Search, X } from 'lucide-react'
import ModalGasto from '../components/ModalGasto'

export default function BuscadorView({ categories, accounts, cards }) {
  const [query, setQuery] = useState('')
  const [resultados, setResultados] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [buscado, setBuscado] = useState(false)
  const [modal, setModal] = useState(null)
  const [refresh, setRefresh] = useState(0)

  async function buscar(q) {
    if (!q.trim()) { setResultados([]); setBuscado(false); return }
    setBuscando(true)
    const { data } = await supabase
      .from('transactions')
      .select('*, categories(name,icon), accounts!transactions_account_id_fkey(name), cards(name)')
      .ilike('description', `%${q.trim()}%`)
      .order('date', { ascending: false })
      .limit(50)
    setResultados(data || [])
    setBuscado(true)
    setBuscando(false)
  }

  function limpiar() {
    setQuery('')
    setResultados([])
    setBuscado(false)
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <div className="max-w-md mx-auto p-4">
        <h1 className="text-xl font-bold text-brand-600 mb-4">Buscar</h1>

        {/* Input */}
        <div className="relative mb-4">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="w-full bg-white border border-gray-200 rounded-xl pl-9 pr-10 py-3 text-sm focus:outline-none focus:border-brand-400"
            placeholder="Buscar por descripción..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); buscar(e.target.value) }}
          />
          {query && (
            <button onClick={limpiar} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
              <X size={16} />
            </button>
          )}
        </div>

        {/* Resultados */}
        {buscando && <p className="text-center text-gray-400">Buscando...</p>}

        {buscado && !buscando && resultados.length === 0 && (
          <p className="text-center text-gray-400 mt-8">Sin resultados para "{query}"</p>
        )}

        {resultados.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-gray-400 font-medium mb-1">{resultados.length} resultados</p>
            {resultados.map((m) => {
              const fechaObj = new Date(m.date + 'T00:00:00')
              const medio = m.cards?.name ? `💳 ${m.cards.name}` : m.accounts?.name || ''
              return (
                <button
                  key={m.id}
                  onClick={() => setModal({ editData: m })}
                  className="w-full bg-white rounded-xl shadow-sm px-3 py-3 flex items-center gap-3 text-left hover:bg-gray-50"
                >
                  <div className="shrink-0 w-10 text-center bg-gray-100 rounded-lg py-1">
                    <p className="text-sm font-bold text-gray-700 leading-none">
                      {format(fechaObj, 'd', { locale: es })}
                    </p>
                    <p className="text-xs text-gray-400 capitalize">
                      {format(fechaObj, 'MMM yy', { locale: es })}
                    </p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-800 text-sm truncate">{m.description}</p>
                    <p className="text-xs text-gray-400 mt-0.5 truncate">
                      {m.categories?.icon} {m.categories?.name || ''}
                      {medio ? ` · ${medio}` : ''}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`font-bold text-sm ${m.type === 'income' ? 'text-green-600' : 'text-gray-800'}`}>
                      {m.type === 'income' ? '+' : '-'}{fmtARS(m.amount_ars)}
                    </p>
                    {Number(m.amount_usd) > 0 && (
                      <p className="text-xs text-gray-400">{fmtUSD(m.amount_usd)}</p>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {modal && (
        <ModalGasto
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); setRefresh(r => r + 1); buscar(query) }}
          editData={modal?.editData || null}
          categories={categories}
          accounts={accounts}
          cards={cards}
        />
      )}
    </div>
  )
}
