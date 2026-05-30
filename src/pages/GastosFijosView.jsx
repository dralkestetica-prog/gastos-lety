import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtARS } from '../lib/formato'
import { Plus, X, Check, Trash2 } from 'lucide-react'
import { format } from 'date-fns'

const MES_ACTUAL = format(new Date(), 'yyyy-MM')
const FORM_VACIO = { name: '', amount_ars: '', category_id: '', account_id: '', card_id: '', due_day: '', tipo: 'expense' }

export default function GastosFijosView({ categories, accounts, cards }) {
  const [fijos, setFijos] = useState([])
  const [pagados, setPagados] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('expense') // 'expense' | 'income'
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(FORM_VACIO)
  const [saving, setSaving] = useState(false)

  async function cargar() {
    const [{ data: fijosList }, { data: txPagadas }] = await Promise.all([
      supabase.from('fixed_expenses').select('*, categories(name,icon)').eq('is_active', true).order('due_day'),
      supabase.from('transactions').select('fixed_expense_id').eq('is_fixed', true)
        .gte('date', MES_ACTUAL + '-01').lte('date', MES_ACTUAL + '-31').not('fixed_expense_id', 'is', null),
    ])
    setFijos(fijosList || [])
    setPagados(new Set((txPagadas || []).map(t => t.fixed_expense_id)))
    setLoading(false)
  }

  const fijosFiltrados = fijos.filter(f => (f.type || 'expense') === tab)

  useEffect(() => { cargar() }, [])

  function abrirEditar(fijo) {
    setForm({
      name: fijo.name || '',
      amount_ars: fijo.amount_ars || '',
      category_id: fijo.category_id || '',
      account_id: fijo.account_id || '',
      card_id: fijo.card_id || '',
      due_day: fijo.due_day || '',
    })
    setModal(fijo)
  }

  function abrirNuevo() {
    setForm({ ...FORM_VACIO, tipo: tab })
    setModal('nuevo')
  }

  async function marcarPagado(fijo) {
    if (pagados.has(fijo.id)) return
    const dia = String(fijo.due_day || 1).padStart(2, '0')
    if (navigator.vibrate) navigator.vibrate(50)
    await supabase.from('transactions').insert({
      type: fijo.type || 'expense',
      description: fijo.name,
      date: `${MES_ACTUAL}-${dia}`,
      amount_ars: fijo.amount_ars,
      amount_usd: fijo.amount_usd || 0,
      category_id: fijo.category_id,
      account_id: fijo.account_id || null,
      card_id: fijo.card_id || null,
      is_fixed: true,
      fixed_expense_id: fijo.id,
    })
    cargar()
  }

  async function guardar() {
    if (!form.name || !form.amount_ars) return
    setSaving(true)
    const isCard = cards.some(c => c.id === form.card_id)
    const payload = {
      name: form.name,
      amount_ars: parseFloat(form.amount_ars),
      amount_usd: 0,
      category_id: form.category_id || null,
      account_id: isCard ? null : (form.account_id || null),
      card_id: isCard ? form.card_id : null,
      payment_method: isCard ? 'card' : 'account',
      due_day: parseInt(form.due_day) || 1,
      is_active: true,
      type: form.tipo || 'expense',
    }
    if (modal === 'nuevo') {
      await supabase.from('fixed_expenses').insert(payload)
    } else {
      await supabase.from('fixed_expenses').update(payload).eq('id', modal.id)
    }
    setSaving(false)
    setModal(null)
    cargar()
  }

  async function eliminar(id) {
    if (!confirm('¿Eliminar este gasto fijo?')) return
    await supabase.from('fixed_expenses').update({ is_active: false }).eq('id', id)
    setModal(null)
    cargar()
  }

  const totalFijos = fijosFiltrados.reduce((s, f) => s + Number(f.amount_ars), 0)
  const totalPagado = fijosFiltrados.filter(f => pagados.has(f.id)).reduce((s, f) => s + Number(f.amount_ars), 0)

  if (loading) return <p className="text-center text-gray-400 mt-20">Cargando...</p>

  const selectedMedioId = form.card_id || form.account_id
  const esEdicion = modal && modal !== 'nuevo'

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <div className="max-w-md mx-auto p-4">

        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-brand-600">Recurrentes</h1>
          <button onClick={abrirNuevo} className="w-9 h-9 bg-brand-600 text-white rounded-full flex items-center justify-center">
            <Plus size={20} />
          </button>
        </div>

        {/* Tabs gastos / ingresos */}
        <div className="flex rounded-xl overflow-hidden border border-gray-200 mb-4">
          <button onClick={() => setTab('expense')}
            className={`flex-1 py-2 text-sm font-semibold transition-colors ${tab === 'expense' ? 'bg-red-500 text-white' : 'text-gray-500'}`}>
            Gastos fijos
          </button>
          <button onClick={() => setTab('income')}
            className={`flex-1 py-2 text-sm font-semibold transition-colors ${tab === 'income' ? 'bg-green-500 text-white' : 'text-gray-500'}`}>
            Ingresos fijos
          </button>
        </div>

        {/* Resumen */}
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
          <div className="flex justify-between mb-2">
            <div>
              <p className="text-xs text-gray-400">{tab === 'expense' ? 'Total gastos / mes' : 'Total ingresos / mes'}</p>
              <p className={`text-xl font-bold ${tab === 'income' ? 'text-green-600' : 'text-gray-800'}`}>{fmtARS(totalFijos)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400">{tab === 'expense' ? 'Pagado este mes' : 'Cobrado este mes'}</p>
              <p className="text-xl font-bold text-green-600">{fmtARS(totalPagado)}</p>
            </div>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full transition-all"
              style={{ width: totalFijos ? `${Math.min((totalPagado / totalFijos) * 100, 100)}%` : '0%' }} />
          </div>
          <p className="text-xs text-gray-400 mt-1">
            {fijosFiltrados.filter(f => pagados.has(f.id)).length} de {fijosFiltrados.length} {tab === 'expense' ? 'pagados' : 'cobrados'}
          </p>
        </div>

        {fijosFiltrados.length === 0 ? (
          <p className="text-center text-gray-400 mt-10">No hay {tab === 'expense' ? 'gastos' : 'ingresos'} fijos.<br/>Tocá + para agregar.</p>
        ) : (
          <div className="space-y-2">
            {fijosFiltrados.map(f => {
              const esPagado = pagados.has(f.id)
              return (
                <button
                  key={f.id}
                  onClick={() => abrirEditar(f)}
                  className={`w-full bg-white rounded-xl shadow-sm px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50 transition-opacity ${esPagado ? 'opacity-50' : ''}`}
                >
                  <div className="shrink-0 w-8 text-center">
                    <p className="text-xs text-gray-400">día</p>
                    <p className="text-sm font-bold text-gray-700">{f.due_day || '-'}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-800 text-sm truncate">{f.name}</p>
                    <p className="text-xs text-gray-400">{f.categories?.icon} {f.categories?.name || ''}</p>
                  </div>
                  <p className="font-bold text-sm text-gray-800 shrink-0">{fmtARS(f.amount_ars)}</p>
                  <div
                    onClick={e => { e.stopPropagation(); marcarPagado(f) }}
                    className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${esPagado ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400 hover:bg-green-50 hover:text-green-500'}`}
                  >
                    <Check size={16} />
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Modal nuevo/editar */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setModal(null)}>
          <div className="bg-white w-full max-w-md rounded-t-2xl p-5 pb-8 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold text-gray-800">
                {esEdicion ? (form.tipo === 'income' ? 'Editar ingreso fijo' : 'Editar gasto fijo') : (form.tipo === 'income' ? 'Nuevo ingreso fijo' : 'Nuevo gasto fijo')}
              </h2>
              <div className="flex gap-2">
                {esEdicion && (
                  <button onClick={() => eliminar(modal.id)} className="p-2 text-red-400 hover:bg-red-50 rounded-full">
                    <Trash2 size={18} />
                  </button>
                )}
                <button onClick={() => setModal(null)}><X size={20} className="text-gray-400" /></button>
              </div>
            </div>
            <input className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" placeholder="Nombre (ej: Alquiler)" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <input type="number" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" placeholder="Monto ARS" value={form.amount_ars} onChange={e => setForm(f => ({ ...f, amount_ars: e.target.value }))} />
            <input type="number" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" placeholder="Día del mes (ej: 5)" min="1" max="31" value={form.due_day} onChange={e => setForm(f => ({ ...f, due_day: e.target.value }))} />
            <select className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white" value={form.category_id} onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}>
              <option value="">Categoría (opcional)</option>
              {categories.filter(c => c.kind === 'expense' || c.kind === 'both').map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select>
            <select className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"
              value={selectedMedioId}
              onChange={e => {
                const val = e.target.value
                cards.some(c => c.id === val)
                  ? setForm(f => ({ ...f, card_id: val, account_id: '' }))
                  : setForm(f => ({ ...f, account_id: val, card_id: '' }))
              }}>
              <option value="">Medio de pago (opcional)</option>
              <optgroup label="Cuentas">{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>
              <optgroup label="Tarjetas">{cards.map(c => <option key={c.id} value={c.id}>💳 {c.name}</option>)}</optgroup>
            </select>
            <button onClick={guardar} disabled={saving} className="w-full bg-brand-600 text-white font-semibold py-3 rounded-xl disabled:opacity-50">
              {saving ? 'Guardando...' : esEdicion ? 'Guardar cambios' : 'Agregar'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
