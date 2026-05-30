import { useState, useEffect } from 'react'
import { X, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { format } from 'date-fns'
import { useConfirm } from '../hooks/useConfirm'

const HOY = format(new Date(), 'yyyy-MM-dd')

const EMPTY = {
  type: 'expense',
  description: '',
  date: HOY,
  amount_ars: '',
  amount_usd: '',
  category_id: '',
  account_id: '',
  card_id: '',
  cuotas: 1,
  notes: '',
}

export default function ModalGasto({ onClose, onSaved, editData, categories, accounts, cards }) {
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)
  const confirm = useConfirm()

  useEffect(() => {
    if (!editData) {
      setForm({ ...EMPTY, date: format(new Date(), 'yyyy-MM-dd') })
      return
    }
    if (editData) {
      setForm({
        type: editData.type || 'expense',
        description: editData.description || '',
        date: editData.date || HOY,
        amount_ars: editData.amount_ars || '',
        amount_usd: editData.amount_usd || '',
        category_id: editData.category_id || '',
        account_id: editData.account_id || '',
        card_id: editData.card_id || '',
        cuotas: editData.installment_id ? '' : 1,
        notes: editData.notes || '',
      })
    }
  }, [editData])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const esUSD = () => {
    const acc = accounts.find((a) => a.id === form.account_id)
    return acc?.currency === 'USD'
  }

  const esTarjeta = () => !!form.card_id

  const categoriasFiltradas = categories.filter(
    (c) => c.kind === form.type || c.kind === 'both'
  )

  async function guardar() {
    if (!form.description.trim()) return setError('Ingresá una descripción')
    if (!form.amount_ars && !form.amount_usd) return setError('Ingresá un monto')
    if (!form.category_id) return setError('Seleccioná una categoría')
    if (!form.account_id && !form.card_id) return setError('Seleccioná un medio de pago')

    setSaving(true)
    setError(null)

    const payload = {
      type: form.type,
      description: form.description.trim(),
      date: form.date,
      amount_ars: parseFloat(form.amount_ars) || 0,
      amount_usd: parseFloat(form.amount_usd) || 0,
      category_id: form.category_id,
      account_id: form.account_id || null,
      card_id: form.card_id || null,
      notes: form.notes.trim() || null,
    }

    try {
      if (esTarjeta() && !editData && parseInt(form.cuotas) > 1) {
        // Crear installment + transacciones por cuota
        const cuotas = parseInt(form.cuotas)
        const montoCuota = Math.round(payload.amount_ars / cuotas)
        const montoCuotaUSD = payload.amount_usd ? payload.amount_usd / cuotas : null

        const { data: inst, error: instErr } = await supabase
          .from('installments')
          .insert({
            description: payload.description,
            card_id: form.card_id,
            category_id: form.category_id,
            purchase_date: form.date,
            total_amount_ars: payload.amount_ars,
            total_amount_usd: payload.amount_usd || null,
            total_installments: cuotas,
            installments_paid: 0,
            first_billing_month: form.date.slice(0, 7) + '-01',
            installment_amount_ars: montoCuota,
            installment_amount_usd: montoCuotaUSD,
            is_active: true,
          })
          .select()
          .single()

        if (instErr) throw instErr

        const txns = Array.from({ length: cuotas }, (_, i) => {
          const d = new Date(form.date)
          d.setMonth(d.getMonth() + i)
          return {
            type: 'expense',
            description: `${payload.description} (${i + 1}/${cuotas})`,
            date: format(d, 'yyyy-MM-dd'),
            amount_ars: montoCuota,
            amount_usd: montoCuotaUSD || 0,
            category_id: form.category_id,
            account_id: null,
            card_id: form.card_id,
            installment_id: inst.id,
            installment_number: i + 1,
          }
        })

        const { error: txErr } = await supabase.from('transactions').insert(txns)
        if (txErr) throw txErr
      } else if (editData) {
        const { error: upErr } = await supabase
          .from('transactions')
          .update(payload)
          .eq('id', editData.id)
        if (upErr) throw upErr
      } else {
        const { error: insErr } = await supabase.from('transactions').insert(payload)
        if (insErr) throw insErr
      }

      if (navigator.vibrate) navigator.vibrate(50)
      setSaved(true)
      setTimeout(() => onSaved(), 600)
    } catch (e) {
      setError(e.message || 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function eliminar() {
    const ok = await confirm('¿Eliminar este movimiento?', {
      destructive: true,
      confirmLabel: 'Eliminar',
      icon: '🗑️',
      detail: 'Esta acción no se puede deshacer.',
    })
    if (!ok) return
    setSaving(true)
    const { error: e } = await supabase.from('transactions').delete().eq('id', editData.id)
    if (e) { setError(e.message); setSaving(false); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white w-full max-w-md rounded-t-2xl p-5 pb-8 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800">
            {editData ? 'Editar movimiento' : 'Nuevo movimiento'}
          </h2>
          <div className="flex gap-2">
            {editData && (
              <button onClick={eliminar} className="p-2 text-red-500 hover:bg-red-50 rounded-full">
                <Trash2 size={18} />
              </button>
            )}
            <button onClick={onClose} className="p-2 text-gray-400 hover:bg-gray-100 rounded-full">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Tipo toggle */}
        <div className="flex rounded-xl overflow-hidden border border-gray-200 mb-4">
          <button
            onClick={() => set('type', 'expense')}
            className={`flex-1 py-2 text-sm font-semibold transition-colors ${
              form.type === 'expense' ? 'bg-red-500 text-white' : 'text-gray-500'
            }`}
          >
            Gasto
          </button>
          <button
            onClick={() => set('type', 'income')}
            className={`flex-1 py-2 text-sm font-semibold transition-colors ${
              form.type === 'income' ? 'bg-green-500 text-white' : 'text-gray-500'
            }`}
          >
            Ingreso
          </button>
        </div>

        <div className="space-y-3">
          {/* Descripción */}
          <div>
            <label className="text-xs text-gray-500 font-medium">Descripción</label>
            <input
              className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-brand-400"
              placeholder="Ej: Supermercado"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>

          {/* Fecha */}
          <div>
            <label className="text-xs text-gray-500 font-medium">Fecha</label>
            <input
              type="date"
              className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-brand-400"
              value={form.date}
              onChange={(e) => set('date', e.target.value)}
            />
          </div>

          {/* Monto ARS */}
          <div>
            <label className="text-xs text-gray-500 font-medium">Monto en pesos (ARS)</label>
            <input
              type="number"
              className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-brand-400"
              placeholder="0"
              value={form.amount_ars}
              onChange={(e) => set('amount_ars', e.target.value)}
            />
          </div>

          {/* Monto USD — solo si cuenta USD o siempre visible como opcional */}
          <div>
            <label className="text-xs text-gray-500 font-medium">
              Monto en USD{' '}
              <span className="text-gray-400 font-normal">(opcional)</span>
            </label>
            <input
              type="number"
              className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-brand-400"
              placeholder="0"
              value={form.amount_usd}
              onChange={(e) => set('amount_usd', e.target.value)}
            />
          </div>

          {/* Categoría */}
          <div>
            <label className="text-xs text-gray-500 font-medium">Categoría</label>
            <select
              className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-brand-400 bg-white"
              value={form.category_id}
              onChange={(e) => set('category_id', e.target.value)}
            >
              <option value="">Seleccionar...</option>
              {categoriasFiltradas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Medio de pago */}
          <div>
            <label className="text-xs text-gray-500 font-medium">Medio de pago</label>
            <select
              className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-brand-400 bg-white"
              value={form.card_id || form.account_id}
              onChange={(e) => {
                const val = e.target.value
                const isCard = cards.some((c) => c.id === val)
                if (isCard) {
                  set('card_id', val)
                  set('account_id', '')
                } else {
                  set('account_id', val)
                  set('card_id', '')
                }
              }}
            >
              <option value="">Seleccionar...</option>
              <optgroup label="Cuentas">
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </option>
                ))}
              </optgroup>
              <optgroup label="Tarjetas de crédito">
                {cards.map((c) => (
                  <option key={c.id} value={c.id}>
                    💳 {c.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          {/* Cuotas — solo si tarjeta y es nuevo */}
          {esTarjeta() && !editData && (
            <div>
              <label className="text-xs text-gray-500 font-medium">Cantidad de cuotas</label>
              <select
                className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-brand-400 bg-white"
                value={form.cuotas}
                onChange={(e) => set('cuotas', e.target.value)}
              >
                {[1, 2, 3, 6, 9, 12, 18, 24].map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? '1 cuota (contado)' : `${n} cuotas`}
                  </option>
                ))}
              </select>
              {parseInt(form.cuotas) > 1 && form.amount_ars && (
                <p className="text-xs text-gray-400 mt-1">
                  ≈ ${Math.round(parseFloat(form.amount_ars) / parseInt(form.cuotas)).toLocaleString('es-AR')} / mes
                </p>
              )}
            </div>
          )}

          {/* Notas */}
          <div>
            <label className="text-xs text-gray-500 font-medium">Notas <span className="text-gray-400 font-normal">(opcional)</span></label>
            <textarea
              className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-brand-400 resize-none"
              placeholder="Detalle adicional..."
              rows={2}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
            />
          </div>
        </div>

        {error && (
          <p className="mt-3 text-sm text-red-500 bg-red-50 rounded-xl px-3 py-2">{error}</p>
        )}

        <button
          onClick={guardar}
          disabled={saving}
          className={`mt-5 w-full font-semibold py-3 rounded-xl disabled:opacity-50 transition-all ${saved ? 'bg-green-500 text-white' : 'bg-brand-600 text-white hover:bg-brand-700'}`}
        >
          {saved ? '✓ Guardado' : saving ? 'Guardando...' : editData ? 'Guardar cambios' : 'Agregar'}
        </button>
      </div>
    </div>
  )
}
