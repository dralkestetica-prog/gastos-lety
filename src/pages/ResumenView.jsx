import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { fmtARS } from '../lib/formato'
import { format, subMonths } from 'date-fns'
import { es } from 'date-fns/locale'
import { TrendingUp, TrendingDown } from 'lucide-react'

const HOY = new Date()

function mesLabel(d) {
  return format(d, 'MMM', { locale: es })
}

export default function ResumenView() {
  const [datos, setDatos] = useState([])
  const [cuotas, setCuotas] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function cargar() {
      // Traer todos los movimientos de los últimos 6 meses
      const desde = format(subMonths(HOY, 5), 'yyyy-MM-01')
      const hasta = format(new Date(HOY.getFullYear(), HOY.getMonth() + 1, 0), 'yyyy-MM-dd')

      const { data } = await supabase
        .from('transactions')
        .select('type, amount_ars, date')
        .gte('date', desde)
        .lte('date', hasta)

      if (!data) { setLoading(false); return }

      // Agrupar por mes
      const meses = Array.from({ length: 6 }, (_, i) => {
        const d = subMonths(HOY, 5 - i)
        const key = format(d, 'yyyy-MM')
        const movsMes = data.filter((t) => t.date.startsWith(key))
        const ingresos = movsMes.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount_ars), 0)
        const egresos = movsMes.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount_ars), 0)
        return { label: mesLabel(d), key, ingresos, egresos, saldo: ingresos - egresos }
      })

      setDatos(meses)

      // Cuotas activas pendientes
      const { data: instData } = await supabase
        .from('installments')
        .select('description, installment_amount_ars, total_installments, installments_paid, first_billing_month, cards(name)')
        .eq('is_active', true)
        .order('first_billing_month')
      setCuotas(instData || [])

      setLoading(false)
    }
    cargar()
  }, [])

  if (loading) return <p className="text-center text-gray-400 mt-20">Cargando...</p>

  const totalIngresos = datos.reduce((s, m) => s + m.ingresos, 0)
  const totalEgresos = datos.reduce((s, m) => s + m.egresos, 0)
  const saldoAcumulado = totalIngresos - totalEgresos

  const maxEgreso = Math.max(...datos.map((d) => d.egresos), 1)

  // Comparar último mes vs anterior
  const ultimo = datos[5]
  const anterior = datos[4]
  const difEgreso = ultimo && anterior ? ultimo.egresos - anterior.egresos : 0

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <div className="max-w-md mx-auto p-4">
        <h1 className="text-xl font-bold text-brand-600 mb-5">Resumen general</h1>

        {/* Balance acumulado 6 meses */}
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
          <p className="text-xs text-gray-400 mb-1">Balance acumulado (6 meses)</p>
          <p className={`text-3xl font-bold ${saldoAcumulado >= 0 ? 'text-green-600' : 'text-red-500'}`}>
            {fmtARS(saldoAcumulado)}
          </p>
          <div className="flex gap-4 mt-2">
            <div>
              <p className="text-xs text-gray-400">Ingresos totales</p>
              <p className="text-sm font-semibold text-green-600">{fmtARS(totalIngresos)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Egresos totales</p>
              <p className="text-sm font-semibold text-red-500">{fmtARS(totalEgresos)}</p>
            </div>
          </div>
        </div>

        {/* Comparativa mes a mes */}
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Egresos por mes</h3>

          {/* Barras */}
          <div className="flex items-end gap-2 h-28 mb-2">
            {datos.map((d, i) => {
              const h = Math.round((d.egresos / maxEgreso) * 100)
              const esMesActual = i === 5
              return (
                <div key={d.key} className="flex-1 flex flex-col items-center gap-1">
                  <p className="text-xs text-gray-400 font-medium">{(d.egresos/1000).toFixed(0)}k</p>
                  <div className="w-full flex items-end" style={{ height: '72px' }}>
                    <div
                      className={`w-full rounded-t-lg transition-all ${esMesActual ? 'bg-brand-600' : 'bg-gray-200'}`}
                      style={{ height: `${Math.max(h, 4)}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 capitalize">{d.label}</p>
                </div>
              )
            })}
          </div>

          {/* Comparativa último vs anterior */}
          {ultimo && anterior && (
            <div className={`flex items-center gap-2 mt-3 px-3 py-2 rounded-xl text-sm ${
              difEgreso <= 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
            }`}>
              {difEgreso <= 0
                ? <TrendingDown size={16} />
                : <TrendingUp size={16} />
              }
              <span className="font-medium">
                {difEgreso <= 0
                  ? `Gastaste ${fmtARS(Math.abs(difEgreso))} menos que el mes anterior`
                  : `Gastaste ${fmtARS(difEgreso)} más que el mes anterior`
                }
              </span>
            </div>
          )}
        </div>

        {/* Tabla comparativa */}
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Detalle por mes</h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 border-b border-gray-100">
                <th className="text-left py-1.5 font-medium">Mes</th>
                <th className="text-right py-1.5 font-medium">Ingresos</th>
                <th className="text-right py-1.5 font-medium">Egresos</th>
                <th className="text-right py-1.5 font-medium">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {[...datos].reverse().map((d) => (
                <tr key={d.key} className="border-b border-gray-50">
                  <td className="py-2 capitalize text-gray-700 font-medium">{d.label}</td>
                  <td className="py-2 text-right text-green-600">{fmtARS(d.ingresos)}</td>
                  <td className="py-2 text-right text-red-500">{fmtARS(d.egresos)}</td>
                  <td className={`py-2 text-right font-semibold ${d.saldo >= 0 ? 'text-gray-800' : 'text-red-500'}`}>
                    {fmtARS(d.saldo)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Cuotas comprometidas */}
        {cuotas.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Cuotas activas</h3>
            <div className="space-y-3">
              {cuotas.map((c, i) => {
                const restantes = c.total_installments - c.installments_paid
                const totalRestante = restantes * Number(c.installment_amount_ars)
                const pct = Math.round((c.installments_paid / c.total_installments) * 100)
                return (
                  <div key={i}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-700 font-medium truncate max-w-[55%]">{c.description}</span>
                      <span className="text-gray-500">
                        {c.installments_paid}/{c.total_installments} · {fmtARS(c.installment_amount_ars)}/mes
                      </span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-brand-400 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {restantes} cuotas restantes · {fmtARS(totalRestante)} total · 💳 {c.cards?.name}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
