import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtARS } from '../lib/formato'
import { Settings, X, Check } from 'lucide-react'

export default function Presupuesto({ movs, categories }) {
  const [presupuestos, setPresupuestos] = useState({}) // { category_id: amount }
  const [editando, setEditando] = useState(false)
  const [draft, setDraft] = useState({})

  useEffect(() => {
    supabase.from('app_config').select('value').eq('key', 'budgets').single()
      .then(({ data }) => {
        if (data?.value) { setPresupuestos(data.value); setDraft(data.value) }
      })
  }, [])

  async function guardar() {
    await supabase.from('app_config').upsert({ key: 'budgets', value: draft, updated_at: new Date().toISOString() })
    setPresupuestos(draft)
    setEditando(false)
  }

  // Calcular gasto real por categoría
  const gastoPorCat = {}
  movs.filter(m => m.type === 'expense').forEach(m => {
    if (!m.category_id) return
    gastoPorCat[m.category_id] = (gastoPorCat[m.category_id] || 0) + Number(m.amount_ars)
  })

  const catsConPresupuesto = categories.filter(c =>
    (c.kind === 'expense' || c.kind === 'both') && presupuestos[c.id]
  )

  if (!editando && catsConPresupuesto.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-sm p-4 mb-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-700">Presupuesto mensual</p>
          <p className="text-xs text-gray-400">No configurado</p>
        </div>
        <button onClick={() => setEditando(true)} className="text-brand-600 text-xs font-medium flex items-center gap-1">
          <Settings size={14} /> Configurar
        </button>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">Presupuesto</h3>
        <button onClick={() => setEditando(!editando)} className="text-brand-600">
          {editando ? <X size={16} /> : <Settings size={16} />}
        </button>
      </div>

      {editando ? (
        <div className="space-y-2">
          {categories.filter(c => c.kind === 'expense' || c.kind === 'both').map(c => (
            <div key={c.id} className="flex items-center gap-2">
              <span className="text-sm w-32 truncate text-gray-600">{c.icon} {c.name}</span>
              <input
                type="number"
                className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                placeholder="Sin límite"
                value={draft[c.id] || ''}
                onChange={e => setDraft(d => ({ ...d, [c.id]: e.target.value ? Number(e.target.value) : undefined }))}
              />
            </div>
          ))}
          <button onClick={guardar} className="w-full mt-2 bg-brand-600 text-white text-sm font-semibold py-2 rounded-xl flex items-center justify-center gap-1">
            <Check size={14} /> Guardar
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {catsConPresupuesto.map(c => {
            const limite = presupuestos[c.id]
            const gasto = gastoPorCat[c.id] || 0
            const pct = Math.min((gasto / limite) * 100, 100)
            const excedido = gasto > limite
            return (
              <div key={c.id}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-600">{c.icon} {c.name}</span>
                  <span className={excedido ? 'text-red-500 font-semibold' : 'text-gray-500'}>
                    {fmtARS(gasto)} / {fmtARS(limite)}
                  </span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${excedido ? 'bg-red-500' : pct > 80 ? 'bg-yellow-400' : 'bg-green-500'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {excedido && (
                  <p className="text-xs text-red-500 mt-0.5">⚠️ Excedido por {fmtARS(gasto - limite)}</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
