import { useEffect, useState, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { fmtARS, fmtUSD } from '../lib/formato'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, Plus, Download, FileText } from 'lucide-react'
import ModalGasto from '../components/ModalGasto'
import GraficoCategoria from '../components/GraficoCategoria'
import Presupuesto from '../components/Presupuesto'
import { SkeletonList, SkeletonSummaryCards } from '../components/Skeleton'
import { useCountUp } from '../hooks/useCountUp'

export default function MesView({ categories, accounts, cards }) {
  const [mes, setMes] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [movs, setMovs] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [refresh, setRefresh] = useState(0)
  const [filtroMedio, setFiltroMedio] = useState('todos')
  const [pullY, setPullY] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const touchStartY = useRef(null)

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

  // Pull to refresh
  function onTouchStart(e) {
    if (window.scrollY === 0) touchStartY.current = e.touches[0].clientY
  }
  function onTouchMove(e) {
    if (!touchStartY.current) return
    const diff = e.touches[0].clientY - touchStartY.current
    if (diff > 0 && diff < 90) setPullY(diff)
  }
  async function onTouchEnd() {
    if (pullY > 60) {
      setRefreshing(true)
      await cargar()
      setRefreshing(false)
    }
    setPullY(0)
    touchStartY.current = null
  }

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
  const egresos  = movsFiltrados.filter((m) => m.type === 'expense').reduce((s, m) => s + Number(m.amount_ars), 0)
  const saldo    = ingresos - egresos

  // Counter animations
  const ingresosAnim = useCountUp(ingresos)
  const egresosAnim  = useCountUp(egresos)
  const saldoAnim    = useCountUp(Math.abs(saldo))

  // Solo mostrar medios que tienen movimientos este mes
  const mediosConMovs = useMemo(() => {
    const accIds = new Set(movs.map((m) => m.account_id).filter(Boolean))
    const cardIds = new Set(movs.map((m) => m.card_id).filter(Boolean))
    return { accIds, cardIds }
  }, [movs])

  return (
    <div
      className="min-h-screen bg-gray-50 pb-24"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Pull to refresh indicator */}
      <div
        className="flex justify-center items-center overflow-hidden transition-all duration-200"
        style={{ height: pullY > 0 ? `${Math.min(pullY, 60)}px` : refreshing ? '48px' : '0px' }}
      >
        <div className={`w-7 h-7 rounded-full border-2 border-brand-600 border-t-transparent ${(pullY > 60 || refreshing) ? 'animate-spin' : ''}`} />
      </div>

      <div className="max-w-md mx-auto px-4 pt-4">

        {/* Header mes */}
        <div className="flex items-center justify-between mb-5">
          <button onClick={() => cambiarMes(-1)} className="w-9 h-9 flex items-center justify-center rounded-full bg-white shadow-card text-gray-500 active:scale-95 transition-all">
            <ChevronLeft size={20} />
          </button>
          <div className="text-center">
            <h1 className="text-xl font-bold text-gray-800 capitalize">
              {format(mes, 'MMMM', { locale: es })}
            </h1>
            <p className="text-xs text-gray-400">{format(mes, 'yyyy')}</p>
          </div>
          <button onClick={() => cambiarMes(1)} className="w-9 h-9 flex items-center justify-center rounded-full bg-white shadow-card text-gray-500 active:scale-95 transition-all">
            <ChevronRight size={20} />
          </button>
        </div>

        {/* Cards resumen */}
        {loading ? <SkeletonSummaryCards /> : (
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="bg-white rounded-2xl shadow-card p-3 text-center">
            <p className="text-xs text-gray-400 mb-1">Ingresos</p>
            <p className="text-sm font-bold text-green-600 leading-tight tabular-nums">
              ${ingresosAnim.toLocaleString('es-AR')}
            </p>
          </div>
          <div className="bg-white rounded-2xl shadow-card p-3 text-center">
            <p className="text-xs text-gray-400 mb-1">Egresos</p>
            <p className="text-sm font-bold text-red-500 leading-tight tabular-nums">
              ${egresosAnim.toLocaleString('es-AR')}
            </p>
          </div>
          <div className="bg-white rounded-2xl shadow-card p-3 text-center">
            <p className="text-xs text-gray-400 mb-1">Saldo</p>
            <p className={`text-sm font-bold leading-tight tabular-nums ${saldo >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              {saldo < 0 ? '-' : ''}${saldoAnim.toLocaleString('es-AR')}
            </p>
          </div>
        </div>
        )}

        {/* Exportar */}
        {!loading && movs.length > 0 && (
          <div className="flex gap-2 mb-4 no-print">
            <button onClick={exportarCSV} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-white rounded-2xl shadow-card text-xs text-gray-500 font-medium active:scale-[0.98] transition-all">
              <Download size={13} /> Exportar CSV
            </button>
            <button onClick={exportarPDF} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-white rounded-2xl shadow-card text-xs text-gray-500 font-medium active:scale-[0.98] transition-all">
              <FileText size={13} /> Exportar PDF
            </button>
          </div>
        )}

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
          <SkeletonList count={6} />
        ) : movsFiltrados.length === 0 ? (
          <div className="flex flex-col items-center justify-center mt-16 gap-3">
            <span className="text-5xl">🔍</span>
            <p className="text-gray-400 font-medium">Sin movimientos este mes</p>
            <p className="text-xs text-gray-300">Tocá + para agregar uno</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide px-1 mb-2">{movsFiltrados.length} movimientos</p>
            {movsFiltrados.map((m) => {
              const fechaObj = new Date(m.date + 'T00:00:00')
              const dia = format(fechaObj, 'd', { locale: es })
              const mes3 = format(fechaObj, 'MMM', { locale: es })
              const medio = m.cards?.name ? `💳 ${m.cards.name}` : m.accounts?.name || ''
              return (
                <button
                  key={m.id}
                  onClick={() => setModal({ editData: m })}
                  className="w-full bg-white rounded-2xl shadow-card px-3 py-3.5 flex items-center gap-3 text-left active:scale-[0.98] transition-all"
                >
                  {/* Fecha */}
                  <div className="shrink-0 w-10 text-center bg-gray-50 rounded-xl py-1.5">
                    <p className="text-sm font-bold text-gray-700 leading-none">{dia}</p>
                    <p className="text-[10px] text-gray-400 capitalize mt-0.5">{mes3}</p>
                  </div>

                  {/* Descripción + categoría */}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-gray-800 text-sm truncate">{m.description}</p>
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
        className="fixed bottom-24 right-5 w-14 h-14 bg-brand-600 text-white rounded-full flex items-center justify-center active:scale-90 transition-all z-30 no-print"
        style={{ boxShadow: '0 8px 24px rgba(219,39,119,0.4), 0 2px 8px rgba(219,39,119,0.3)' }}
      >
        <Plus size={26} strokeWidth={2.5} />
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
