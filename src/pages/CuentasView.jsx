import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtARS, fmtUSD } from '../lib/formato'
import { RefreshCw, CheckCircle } from 'lucide-react'

const TIPO_ICON = { bank: '🏦', wallet: '📱', cash: '💵', other: '📦' }
const TIPO_LABEL = { bank: 'Banco', wallet: 'Billetera', cash: 'Efectivo', other: 'Otro' }

export default function CuentasView({ accounts, cards }) {
  const [balances, setBalances] = useState({})
  const [cardTotals, setCardTotals] = useState({})
  const [cardTxIds, setCardTxIds] = useState({})
  const [dolar, setDolar] = useState(null)
  const [loadingDolar, setLoadingDolar] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pagando, setPagando] = useState(null)

  async function cargarTxns() {
    const { data: txns } = await supabase
      .from('transactions')
      .select('id, account_id, type, amount_ars, amount_usd, card_id, is_paid')

    if (!txns) { setLoading(false); return }

    const bal = {}
    txns.forEach(t => {
      if (!t.account_id) return
      if (!bal[t.account_id]) bal[t.account_id] = { ars: 0, usd: 0 }
      const sign = t.type === 'income' ? 1 : -1
      bal[t.account_id].ars += sign * Number(t.amount_ars)
      bal[t.account_id].usd += sign * Number(t.amount_usd || 0)
    })
    setBalances(bal)

    const ct = {}
    const ctIds = {}
    txns.forEach(t => {
      if (!t.card_id || t.is_paid) return
      if (!ct[t.card_id]) { ct[t.card_id] = 0; ctIds[t.card_id] = [] }
      ct[t.card_id] += Number(t.amount_ars)
      ctIds[t.card_id].push(t.id)
    })
    setCardTotals(ct)
    setCardTxIds(ctIds)
    setLoading(false)
  }

  async function actualizarDolar() {
    setLoadingDolar(true)
    try {
      const res = await fetch('https://dolarapi.com/v1/dolares/blue')
      const data = await res.json()
      const rate = data.venta
      setDolar(rate)
      await supabase.from('app_config').upsert({
        key: 'exchange_rate',
        value: { usd_ars: rate, updated_at: new Date().toISOString().slice(0, 10) },
        updated_at: new Date().toISOString(),
      })
    } catch {
      // fallback to stored rate
      const { data } = await supabase.from('app_config').select('value').eq('key', 'exchange_rate').single()
      if (data?.value?.usd_ars) setDolar(data.value.usd_ars)
    }
    setLoadingDolar(false)
  }

  useEffect(() => {
    cargarTxns()
    // Load stored rate
    supabase.from('app_config').select('value').eq('key', 'exchange_rate').single()
      .then(({ data }) => { if (data?.value?.usd_ars) setDolar(data.value.usd_ars) })
  }, [])

  async function pagarTarjeta(card) {
    const ids = cardTxIds[card.id]
    const total = cardTotals[card.id]
    if (!ids?.length) return
    if (!confirm(`¿Marcar ${card.name} como pagada?\nTotal: ${fmtARS(total)}`)) return

    setPagando(card.id)
    // Marcar txns como pagadas
    await supabase.from('transactions').update({ is_paid: true }).in('id', ids)
    // Registrar el pago como egreso de la cuenta (descuenta del sueldo)
    await supabase.from('transactions').insert({
      type: 'expense',
      description: `Pago tarjeta ${card.name}`,
      date: new Date().toISOString().slice(0, 10),
      amount_ars: total,
      amount_usd: 0,
      category_id: null,
      account_id: accounts[0]?.id || null,
      card_id: null,
      is_paid: true,
    })
    setPagando(null)
    cargarTxns()
  }

  if (loading) return <p className="text-center text-gray-400 mt-20">Cargando...</p>

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <div className="max-w-md mx-auto p-4">
        <h1 className="text-xl font-bold text-brand-600 mb-4">Cuentas y tarjetas</h1>

        {/* Cotización dólar */}
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400">Dólar blue</p>
            <p className="text-xl font-bold text-gray-800">
              {dolar ? `$${dolar.toLocaleString('es-AR')}` : '—'}
            </p>
          </div>
          <button
            onClick={actualizarDolar}
            disabled={loadingDolar}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-200 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loadingDolar ? 'animate-spin' : ''} />
            Actualizar
          </button>
        </div>

        {/* Cuentas */}
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Cuentas</h2>
        <div className="space-y-2 mb-6">
          {accounts.map(a => {
            const b = balances[a.id] || { ars: 0, usd: 0 }
            const isUSD = a.currency === 'USD'
            const monto = isUSD ? b.usd : b.ars
            const enARS = isUSD && dolar ? b.usd * dolar : null
            return (
              <div key={a.id} className="bg-white rounded-xl shadow-sm px-4 py-3 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{TIPO_ICON[a.type] || '💳'}</span>
                  <div>
                    <p className="font-semibold text-gray-800 text-sm">{a.name}</p>
                    <p className="text-xs text-gray-400">{TIPO_LABEL[a.type] || a.type}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`font-bold text-sm ${monto >= 0 ? 'text-gray-800' : 'text-red-500'}`}>
                    {isUSD ? fmtUSD(monto) : fmtARS(monto)}
                  </p>
                  {enARS && <p className="text-xs text-gray-400">≈ {fmtARS(enARS)}</p>}
                </div>
              </div>
            )
          })}
        </div>

        {/* Tarjetas */}
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Tarjetas de crédito</h2>
        <div className="space-y-2">
          {cards.map(c => {
            const pendiente = cardTotals[c.id] || 0
            const isPagando = pagando === c.id
            return (
              <div key={c.id} className="bg-white rounded-xl shadow-sm px-4 py-3 flex items-center gap-3">
                <span className="text-2xl">💳</span>
                <div className="flex-1">
                  <p className="font-semibold text-gray-800 text-sm">{c.name}</p>
                  <p className="text-xs text-gray-400">{c.brand}</p>
                </div>
                <div className="text-right mr-3">
                  <p className={`font-bold text-sm ${pendiente > 0 ? 'text-red-500' : 'text-green-600'}`}>
                    {pendiente > 0 ? fmtARS(pendiente) : '✓ Al día'}
                  </p>
                  <p className="text-xs text-gray-400">{pendiente > 0 ? 'pendiente' : ''}</p>
                </div>
                {pendiente > 0 && (
                  <button
                    onClick={() => pagarTarjeta(c)}
                    disabled={isPagando}
                    className="shrink-0 flex items-center gap-1 px-3 py-1.5 bg-green-500 text-white text-xs font-semibold rounded-xl hover:bg-green-600 disabled:opacity-50"
                  >
                    <CheckCircle size={14} />
                    {isPagando ? '...' : 'Pagar'}
                  </button>
                )}
              </div>
            )
          })}
        </div>

      </div>
    </div>
  )
}
