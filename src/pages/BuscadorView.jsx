import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtARS, fmtUSD } from '../lib/formato'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Search, X } from 'lucide-react'
import ModalGasto from '../components/ModalGasto'

export default function BuscadorView({ categories, accounts, cards }) {
  const [query, setQuery] = useState('')
  const [catFiltro, setCatFiltro] = useState('')
  const [montoMin, setMontoMin] = useState('')
  const [montoMax, setMontoMax] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [resultados, setResultados] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [buscado, setBuscado] = useState(false)
  const [modal, setModal] = useState(null)
  const [mostrarFiltros, setMostrarFiltros] = useState(false)

  async function buscar(q = query, cat = catFiltro, min = montoMin, max = montoMax, de = desde, ha = hasta) {
    const hayFiltro = q.trim() || cat || min || max || de || ha
    if (!hayFiltro) { setResultados([]); setBuscado(false); return }
    setBuscando(true)

    let query_sb = supabase
      .from('transactions')
      .select('*, categories(name,icon), accounts!transactions_account_id_fkey(name), cards(name)')
      .order('date', { ascending: false })
      .limit(200)

    if (q.trim()) query_sb = query_sb.ilike('description', `%${q.trim()}%`)
    if (cat) query_sb = query_sb.eq('category_id', cat)
    if (min) query_sb = query_sb.gte('amount_ars', parseFloat(min))
    if (max) query_sb = query_sb.lte('amount_ars', parseFloat(max))
    if (de) query_sb = query_sb.gte('date', de)
    if (ha) query_sb = query_sb.lte('date', ha)

    const { data } = await query_sb
    setResultados(data || [])
    setBuscado(true)
    setBuscando(false)
  }

  function limpiar() {
    setQuery(''); setCatFiltro(''); setMontoMin(''); setMontoMax(''); setDesde(''); setHasta('')
    setResultados([]); setBuscado(false)
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <div className="max-w-md mx-auto p-4">
        <h1 className="text-xl font-bold text-brand-600 mb-4">Buscar</h1>

        {/* Input principal */}
        <div className="relative mb-2">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="w-full bg-white border border-gray-200 rounded-xl pl-9 pr-10 py-3 text-sm focus:outline-none focus:border-brand-400"
            placeholder="Buscar por descripción..."
            value={query}
            onChange={e => { setQuery(e.target.value); buscar(e.target.value) }}
          />
          {query && (
            <button onClick={limpiar} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
              <X size={16} />
            </button>
          )}
        </div>

        {/* Toggle filtros */}
        <button
          onClick={() => setMostrarFiltros(f => !f)}
          className="text-xs text-brand-600 font-medium mb-3 flex items-center gap-1"
        >
          {mostrarFiltros ? '▲ Ocultar filtros' : '▼ Filtrar por categoría o monto'}
        </button>

        {/* Filtros extra */}
        {mostrarFiltros && (
          <div className="bg-white rounded-xl shadow-sm p-3 mb-3 space-y-2">
            <select
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"
              value={catFiltro}
              onChange={e => { setCatFiltro(e.target.value); buscar(query, e.target.value) }}
            >
              <option value="">Todas las categorías</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select>
            <div className="flex gap-2">
              <input
                type="number"
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm"
                placeholder="Monto mínimo"
                value={montoMin}
                onChange={e => { setMontoMin(e.target.value); buscar(query, catFiltro, e.target.value, montoMax) }}
              />
              <input
                type="number"
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm"
                placeholder="Monto máximo"
                value={montoMax}
                onChange={e => { setMontoMax(e.target.value); buscar(query, catFiltro, montoMin, e.target.value) }}
              />
            </div>
            <div className="flex gap-2 items-center">
              <div className="flex-1">
                <p className="text-xs text-gray-400 mb-1">Desde</p>
                <input
                  type="date"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
                  value={desde}
                  onChange={e => { setDesde(e.target.value); buscar(query, catFiltro, montoMin, montoMax, e.target.value, hasta) }}
                />
              </div>
              <div className="flex-1">
                <p className="text-xs text-gray-400 mb-1">Hasta</p>
                <input
                  type="date"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
                  value={hasta}
                  onChange={e => { setHasta(e.target.value); buscar(query, catFiltro, montoMin, montoMax, desde, e.target.value) }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Resultados */}
        {buscando && <p className="text-center text-gray-400">Buscando...</p>}

        {buscado && !buscando && resultados.length === 0 && (
          <p className="text-center text-gray-400 mt-8">Sin resultados</p>
        )}

        {resultados.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-gray-400 font-medium mb-1">{resultados.length} resultados</p>
            {resultados.map(m => {
              const fechaObj = new Date(m.date + 'T00:00:00')
              const medio = m.cards?.name ? `💳 ${m.cards.name}` : m.accounts?.name || ''
              return (
                <button key={m.id} onClick={() => setModal({ editData: m })}
                  className="w-full bg-white rounded-xl shadow-sm px-3 py-3 flex items-center gap-3 text-left hover:bg-gray-50">
                  <div className="shrink-0 w-10 text-center bg-gray-100 rounded-lg py-1">
                    <p className="text-sm font-bold text-gray-700 leading-none">{format(fechaObj, 'd', { locale: es })}</p>
                    <p className="text-xs text-gray-400 capitalize">{format(fechaObj, 'MMM yy', { locale: es })}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-800 text-sm truncate">{m.description}</p>
                    <p className="text-xs text-gray-400 mt-0.5 truncate">
                      {m.categories?.icon} {m.categories?.name || ''}
                      {medio ? ` · ${medio}` : ''}
                      {m.notes ? ` · 📝` : ''}
                    </p>
                    {m.notes && <p className="text-xs text-gray-400 mt-0.5 truncate italic">{m.notes}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`font-bold text-sm ${m.type === 'income' ? 'text-green-600' : 'text-gray-800'}`}>
                      {m.type === 'income' ? '+' : '-'}{fmtARS(m.amount_ars)}
                    </p>
                    {Number(m.amount_usd) > 0 && <p className="text-xs text-gray-400">{fmtUSD(m.amount_usd)}</p>}
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
          onSaved={() => {
            setModal(null)
            buscar(query, catFiltro, montoMin, montoMax, desde, hasta)
          }}
          editData={modal?.editData || null}
          categories={categories}
          accounts={accounts}
          cards={cards}
        />
      )}
    </div>
  )
}
