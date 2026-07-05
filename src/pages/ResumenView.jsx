import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtARS } from '../lib/formato'
import { format, subMonths } from 'date-fns'
import { es } from 'date-fns/locale'
import { TrendingUp, TrendingDown, X } from 'lucide-react'
import { useConfirm } from '../hooks/useConfirm'
import { SkeletonCard, SkeletonList } from '../components/Skeleton'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import ErrorState from '../components/ErrorState'

const HOY = new Date()

function mesLabel(d) {
  return format(d, 'MMM', { locale: es })
}

export default function ResumenView() {
  const [datos, setDatos] = useState([])
  const [cuotas, setCuotas] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [modalCuota, setModalCuota] = useState(null)
  const [editMonto, setEditMonto] = useState('')
  const [savingCuota, setSavingCuota] = useState(false)
  const confirm = useConfirm()

  useEffect(() => {
    async function cargar() {
      setError(false)
      // Traer todos los movimientos de los últimos 6 meses
      const desde = format(subMonths(HOY, 5), 'yyyy-MM-01')
      const hasta = format(new Date(HOY.getFullYear(), HOY.getMonth() + 1, 0), 'yyyy-MM-dd')

      let data
      try {
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 9000)
        )
        const res = await Promise.race([
          supabase.from('transactions').select('type, amount_ars, date').gte('date', desde).lte('date', hasta),
          timeout,
        ])
        data = res.data
      } catch {
        setError(true)
        setLoading(false)
        return
      }

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

      // Cuotas activas — calcula installments_paid desde transacciones reales
      const { data: instData } = await supabase
        .from('installments')
        .select('id, description, installment_amount_ars, total_installments, installments_paid, first_billing_month, cards(name)')
        .eq('is_active', true)
        .order('first_billing_month')

      if (instData?.length) {
        const hoy = format(new Date(), 'yyyy-MM-dd')
        const { data: txInst } = await supabase
          .from('transactions')
          .select('installment_id, date')
          .in('installment_id', instData.map(i => i.id))
          .lte('date', hoy)

        const pagadasPorInst = {}
        txInst?.forEach(t => {
          pagadasPorInst[t.installment_id] = (pagadasPorInst[t.installment_id] || 0) + 1
        })

        const cuotasActualizadas = instData.map(c => ({
          ...c,
          installments_paid: pagadasPorInst[c.id] || 0,
        }))

        // Sincronizar con DB solo los que cambiaron (evita writes innecesarios)
        const cambiados = cuotasActualizadas.filter(c => {
          const orig = instData.find(i => i.id === c.id)
          return orig && orig.installments_paid !== c.installments_paid
        })
        await Promise.all(cambiados.map(c =>
          supabase.from('installments').update({ installments_paid: c.installments_paid }).eq('id', c.id)
        ))

        setCuotas(cuotasActualizadas.filter(c => c.installments_paid < c.total_installments))
      } else {
        setCuotas([])
      }

      setLoading(false)
    }
    setLoading(true)
    cargar()
  }, [refresh])

  async function guardarCuota() {
    if (!editMonto || !modalCuota) return
    setSavingCuota(true)
    const nuevoMonto = parseFloat(editMonto)
    await supabase.from('installments').update({ installment_amount_ars: nuevoMonto }).eq('id', modalCuota.id)
    // Actualizar también las transacciones pendientes de pago de esta cuota
    const { data: txPendientes } = await supabase
      .from('transactions')
      .select('id, date')
      .eq('installment_id', modalCuota.id)
      .gte('date', format(new Date(), 'yyyy-MM-01'))
    if (txPendientes?.length) {
      await supabase.from('transactions').update({ amount_ars: nuevoMonto }).in('id', txPendientes.map(t => t.id))
    }
    setCuotas(cs => cs.map(c => c.id === modalCuota.id ? { ...c, installment_amount_ars: nuevoMonto } : c))
    setSavingCuota(false)
    setModalCuota(null)
  }

  async function cancelarCuotas() {
    const ok = await confirm('¿Cancelar cuotas restantes?', {
      destructive: true, confirmLabel: 'Cancelar cuotas', icon: '✂️',
      detail: 'Las cuotas que quedan se marcarán como inactivas.',
    })
    if (!ok) return
    setSavingCuota(true)
    await supabase.from('installments').update({ is_active: false }).eq('id', modalCuota.id)
    setCuotas(cs => cs.filter(c => c.id !== modalCuota.id))
    setSavingCuota(false)
    setModalCuota(null)
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <div className="max-w-md mx-auto p-4 space-y-3">
        <div className="h-8 w-40 bg-gray-200 rounded-xl animate-pulse" />
        <SkeletonCard lines={3} />
        <SkeletonCard lines={4} />
        <SkeletonCard lines={3} />
      </div>
    </div>
  )

  if (error) return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <ErrorState mensaje="No se pudieron cargar las estadísticas." onReintentar={() => setRefresh(r => r + 1)} />
    </div>
  )

  const totalIngresos = datos.reduce((s, m) => s + m.ingresos, 0)
  const totalEgresos = datos.reduce((s, m) => s + m.egresos, 0)
  const saldoAcumulado = totalIngresos - totalEgresos

  const maxEgreso = Math.max(...datos.map((d) => d.egresos), 1)

  // Comparar último mes vs anterior
  const ultimo = datos[5]
  const anterior = datos[4]
  const difEgreso = ultimo && anterior ? ultimo.egresos - anterior.egresos : 0

  return (
    <>
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

        {/* Gráfico de línea - evolución mensual */}
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Evolución de egresos</h3>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={datos} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false}
                tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} width={36} />
              <Tooltip
                formatter={(v, name) => [fmtARS(v), name === 'egresos' ? 'Egresos' : 'Ingresos']}
                labelStyle={{ fontSize: 12, color: '#374151', textTransform: 'capitalize' }}
                contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', fontSize: 12 }}
              />
              <Line type="monotone" dataKey="egresos" stroke="#ef4444" strokeWidth={2.5} dot={{ r: 4, fill: '#ef4444' }} activeDot={{ r: 6 }} />
              <Line type="monotone" dataKey="ingresos" stroke="#22c55e" strokeWidth={2} dot={{ r: 3, fill: '#22c55e' }} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-1 justify-center">
            <span className="flex items-center gap-1 text-xs text-gray-500"><span className="w-4 h-0.5 bg-red-400 inline-block rounded" /> Egresos</span>
            <span className="flex items-center gap-1 text-xs text-gray-500"><span className="w-4 h-0.5 bg-green-400 inline-block rounded" style={{borderTop:'2px dashed #22c55e',background:'none'}} /> Ingresos</span>
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
                  <button key={i} onClick={() => { setModalCuota(c); setEditMonto(String(c.installment_amount_ars)) }}
                    className="w-full text-left hover:bg-gray-50 rounded-xl p-2 -mx-2 transition-colors">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-700 font-medium truncate max-w-[55%]">{c.description}</span>
                      <span className="text-brand-600 font-semibold">
                        {fmtARS(c.installment_amount_ars)}/mes
                      </span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-brand-400 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {c.installments_paid}/{c.total_installments} · {restantes} restantes · {fmtARS(totalRestante)} · 💳 {c.cards?.name}
                    </p>
                  </button>
                )
              })}
            </div>
          </div>
        )}

      </div>
    </div>

    {/* Modal editar cuota */}
    {modalCuota && (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setModalCuota(null)}>
        <div className="bg-white w-full max-w-md rounded-t-2xl p-5 pb-8 space-y-4" onClick={e => e.stopPropagation()}>
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-bold text-gray-800">Editar cuota</h2>
            <button onClick={() => setModalCuota(null)}><X size={20} className="text-gray-400" /></button>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-1">{modalCuota.description}</p>
            <p className="text-xs text-gray-400">💳 {modalCuota.cards?.name} · {modalCuota.installments_paid}/{modalCuota.total_installments} cuotas pagadas</p>
          </div>
          <div>
            <label className="text-xs text-gray-500 font-medium">Monto por cuota (ARS)</label>
            <input
              type="number"
              className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400"
              value={editMonto}
              onChange={e => setEditMonto(e.target.value)}
            />
            {editMonto && (
              <p className="text-xs text-gray-400 mt-1">
                Total restante estimado: {fmtARS((modalCuota.total_installments - modalCuota.installments_paid) * parseFloat(editMonto || 0))}
              </p>
            )}
          </div>
          <button onClick={guardarCuota} disabled={savingCuota}
            className="w-full bg-brand-600 text-white font-semibold py-3 rounded-xl disabled:opacity-50">
            {savingCuota ? 'Guardando...' : 'Guardar monto'}
          </button>
          <button onClick={cancelarCuotas} disabled={savingCuota}
            className="w-full bg-red-50 text-red-500 font-semibold py-3 rounded-xl text-sm">
            Cancelar cuotas restantes
          </button>
        </div>
      </div>
    )}
    </>
  )
}
