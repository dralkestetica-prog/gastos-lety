import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { fmtARS, fmtUSD } from '../lib/formato'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, Plus, Download, FileText } from 'lucide-react'
import ModalGasto from '../components/ModalGasto'
import GraficoCategoria from '../components/GraficoCategoria'
import Presupuesto from '../components/Presupuesto'

export default function MesView({ categories, accounts, cards }) {
  const [mes, setMes] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [movs, setMovs] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [refresh, setRefresh] = useState(0)
  const [filtroMedio, setFiltroMedio] = useState('todos')

  async function cargar() {
    setLoading(true)
    const desde = format(mes, 'yyyy-MM-01')
    const hasta = format(new Date(mes.getFullYear(), mes.getMonth() + 1, 0), 'yyyy-MM-dd')

    const { data, error } = await supabase
      .from('transactions')
      .select('*, categories(name,icon), accounts!transactions_account_id_fkey(name), cards(name)')
      .gte('date', desde)
      .lte('date', hasta)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) console.error(error)
    else setMovs(data || [])
    setLoading(false)
  }

  useEffect(() => { cargar() }, [mes, refresh])

  const cambiarMes = (d) => setMes((m) => new Date(m.getFullYear(), m.getMonth() + d, 1))

  function exportarPDF() {
    window.print()
  }

  function exportarCSV() {
    const mesLabel = format(mes, 'yyyy-MM')
    const filas = [
      ['Fecha', 'Descripción', 'Tipo', 'Categoría', 'Medio de pago', 'Monto ARS', 'Monto USD'],
      ...movs.map(m => [
        m.date,
        m.description,
        m.type === 'income' ? 'Ingreso' : 'Gasto',
        m.categories?.name || '',
        m.cards?.name ? `Tarjeta ${m.cards.name}` : m.accounts?.name || '',
        m.amount_ars,
        m.amount_usd || 0,
      ])
    ]
    const csv = filas.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gastos-${mesLabel}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Filtro por medio de pago (client-side)
  const movsFiltrados = useMemo(() => {
    if (filtroMedio === 'todos') return movs
    if (filtroMedio.startsWith('card:')) {
      const id = filtroMedio.replace('card:', '')
      return movs.filter((m) => m.card_id === id)
    }
    if (filtroMedio.startsWith('acc:')) {
      const id = filtroMedio.replace('acc:', '')
      return movs.filter((m) => m.account_id === id)
    }
    return movs
  }, [movs, filtroMedio])

  // Resumen sobre los movimientos filtrados
  const ingresos = movsFiltrados.filter((m) => m.type === 'income').reduce((s, m) => s + Number(m.amount_ars), 0)
  const egresos = movsFiltrados.filter((m) => m.type === 'expense').reduce((s, m) => s + Number(m.amount_ars), 0)
  const saldo = ingresos - egresos

  // Solo mostrar medios que tienen movimientos este mes
  const mediosConMovs = useMemo(() => {
    const accIds = new Set(movs.map((m) => m.account_id).filter(Boolean))
    const cardIds = new Set(movs.map((m) => m.card_id).filter(Boolean))
    return { accIds, cardIds }
  }, [movs])

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <div className="max-w-md mx-auto p-4">

        {/* Header mes */}
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => cambiarMes(-1)} className="p-2 rounded-full hover:bg-gray-200 text-gray-600">
            <ChevronLeft size={24} />
          </button>
          <h1 className="text-xl font-bold text-brand-600 capitalize">
            {format(mes, 'MMMM yyyy', { locale: es })}
          </h1>
          <button onClick={() => cambiarMes(1)} className="p-2 rounded-full hover:bg-gray-200 text-gray-600">
            <ChevronRight size={24} />
          </button>
        </div>

        {/* Exportar */}
        {movs.length > 0 && (
          <div className="flex gap-2 mb-4 no-print">
            <button onClick={exportarCSV} className="flex-1 flex items-center justify-center gap-2 py-2 bg-white rounded-xl shadow-sm text-xs text-gray-500 font-medium hover:bg-gray-50">
              <Download size={14} /> CSV
            </button>
            <button onClick={exportarPDF} className="flex-1 flex items-center justify-center gap-2 py-2 bg-white rounded-xl shadow-sm text-xs text-gray-500 font-medium hover:bg-gray-50">
              <FileText size={14} /> PDF
            </button>
          </div>
        )}

        {/* Cards resumen */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="bg-white rounded-xl shadow-sm p-3 text-center">
            <p className="text-xs text-gray-400 mb-1">Ingresos</p>
            <p className="text-sm font-bold text-green-600 leading-tight">{fmtARS(ingresos)}</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-3 text-center">
            <p className="text-xs text-gray-400 mb-1">Egresos</p>
            <p className="text-sm font-bold text-red-500 leading-tight">{fmtARS(egresos)}</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-3 text-center">
            <p className="text-xs text-gray-400 mb-1">Saldo</p>
            <p className={`text-sm font-bold leading-tight ${saldo >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              {fmtARS(saldo)}
            </p>
          </div>
        </div>

        {/* Gráfico categorías */}
        {!loading && movs.length > 0 && <GraficoCategoria movs={movs} />}

        {/* Presupuesto */}
        {!loading && <Presupuesto movs={movs} categories={categories} />}

        {/* Filtro medio de pago */}
        <div className="flex gap-2 overflow-x-auto pb-2 mb-4 scrollbar-hide">
          <button
            onClick={() => setFiltroMedio('todos')}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              filtroMedio === 'todos'
                ? 'bg-brand-600 text-white border-brand-600'
                : 'bg-white text-gray-600 border-gray-200'
            }`}
          >
            Todos
          </button>
          {accounts.filter((a) => mediosConMovs.accIds.has(a.id)).map((a) => (
            <button
              key={a.id}
              onClick={() => setFiltroMedio(filtroMedio === `acc:${a.id}` ? 'todos' : `acc:${a.id}`)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                filtroMedio === `acc:${a.id}`
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-gray-600 border-gray-200'
              }`}
            >
              {a.name}
            </button>
          ))}
          {cards.filter((c) => mediosConMovs.cardIds.has(c.id)).map((c) => (
            <button
              key={c.id}
              onClick={() => setFiltroMedio(filtroMedio === `card:${c.id}` ? 'todos' : `card:${c.id}`)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                filtroMedio === `card:${c.id}`
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-gray-600 border-gray-200'
              }`}
            >
              💳 {c.name}
            </button>
          ))}
        </div>

        {/* Lista */}
        {loading ? (
          <p className="text-center text-gray-400 mt-10">Cargando...</p>
        ) : movsFiltrados.length === 0 ? (
          <p className="text-center text-gray-400 mt-10">Sin movimientos</p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-gray-400 font-medium mb-1">{movsFiltrados.length} movimientos</p>
            {movsFiltrados.map((m) => {
              const fechaObj = new Date(m.date + 'T00:00:00')
              const dia = format(fechaObj, 'd', { locale: es })
              const mes3 = format(fechaObj, 'MMM', { locale: es })
              const medio = m.cards?.name ? `💳 ${m.cards.name}` : m.accounts?.name || ''
              return (
                <button
                  key={m.id}
                  onClick={() => setModal({ editData: m })}
                  className="w-full bg-white rounded-xl shadow-sm px-3 py-3 flex items-center gap-3 text-left hover:bg-gray-50 active:scale-[0.99] transition-transform"
                >
                  {/* Fecha */}
                  <div className="shrink-0 w-10 text-center bg-gray-100 rounded-lg py-1">
                    <p className="text-sm font-bold text-gray-700 leading-none">{dia}</p>
                    <p className="text-xs text-gray-400 capitalize">{mes3}</p>
                  </div>

                  {/* Descripción + categoría */}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-800 text-sm truncate">{m.description}</p>
                    <p className="text-xs text-gray-400 mt-0.5 truncate">
                      {m.categories?.icon} {m.categories?.name || ''}
                      {medio ? ` · ${medio}` : ''}
                      {m.notes ? ` · 📝` : ''}
                    </p>
                  </div>

                  {/* Monto */}
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

      {/* FAB */}
      <button
        onClick={() => setModal('nuevo')}
        className="fixed bottom-24 right-5 w-14 h-14 bg-brand-600 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-brand-700 active:scale-95 transition-all z-30"
      >
        <Plus size={28} />
      </button>

      {/* Modal */}
      {modal && (
        <ModalGasto
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); setRefresh(r => r + 1) }}
          editData={modal?.editData || null}
          categories={categories}
          accounts={accounts}
          cards={cards}
        />
      )}
    </div>
  )
}
