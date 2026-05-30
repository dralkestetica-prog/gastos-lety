import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtARS, fmtUSD } from '../lib/formato'
import { RefreshCw, CheckCircle, ChevronRight, X, Upload } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

const TIPO_ICON = { bank: '🏦', wallet: '📱', cash: '💵', other: '📦' }
const TIPO_LABEL = { bank: 'Banco', wallet: 'Billetera', cash: 'Efectivo', other: 'Otro' }

export default function CuentasView({ accounts, cards, categories }) {
  const [balances, setBalances] = useState({})
  const [cardTotals, setCardTotals] = useState({})
  const [cardTxIds, setCardTxIds] = useState({})
  const [dolar, setDolar] = useState(null)
  const [loadingDolar, setLoadingDolar] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pagando, setPagando] = useState(null)
  const [cuentaDetalle, setCuentaDetalle] = useState(null) // cuenta seleccionada
  const [movsCuenta, setMovsCuenta] = useState([])
  const [loadingMovs, setLoadingMovs] = useState(false)
  const [modalImport, setModalImport] = useState(false)
  const [importando, setImportando] = useState(false)
  const [importMsg, setImportMsg] = useState(null)
  const [importBanco, setImportBanco] = useState('mp')
  const [modalPago, setModalPago] = useState(null) // { card, total, ids }

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

    const ct = {}, ctIds = {}
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

  async function verMovimientosCuenta(cuenta) {
    setCuentaDetalle(cuenta)
    setLoadingMovs(true)
    const { data } = await supabase
      .from('transactions')
      .select('*, categories(name,icon), accounts!transactions_account_id_fkey(name)')
      .eq('account_id', cuenta.id)
      .order('date', { ascending: false })
      .limit(50)
    setMovsCuenta(data || [])
    setLoadingMovs(false)
  }

  async function actualizarDolar() {
    setLoadingDolar(true)
    try {
      const res = await fetch('https://dolarapi.com/v1/dolares/blue')
      const data = await res.json()
      setDolar(data.venta)
      await supabase.from('app_config').upsert({
        key: 'exchange_rate',
        value: { usd_ars: data.venta, updated_at: new Date().toISOString().slice(0, 10) },
        updated_at: new Date().toISOString(),
      })
    } catch {
      const { data } = await supabase.from('app_config').select('value').eq('key', 'exchange_rate').single()
      if (data?.value?.usd_ars) setDolar(data.value.usd_ars)
    }
    setLoadingDolar(false)
  }

  useEffect(() => {
    cargarTxns()
    // Cargar cotización guardada primero, luego intentar actualizar
    supabase.from('app_config').select('value').eq('key', 'exchange_rate').single()
      .then(({ data }) => {
        if (data?.value?.usd_ars) setDolar(data.value.usd_ars)
        // Auto-actualizar si el dato tiene más de 1 hora
        const updated = data?.value?.updated_at
        const stale = !updated || (new Date() - new Date(updated)) > 3600000
        if (stale) actualizarDolar()
      })
  }, [])

  function pagarTarjeta(card) {
    const ids = cardTxIds[card.id]
    const total = cardTotals[card.id]
    if (!ids?.length) return
    setModalPago({ card, total, ids })
  }

  async function confirmarPago(cuentaPago) {
    const { card, total, ids } = modalPago
    setModalPago(null)
    setPagando(card.id)
    await supabase.from('transactions').update({ is_paid: true }).in('id', ids)
    await supabase.from('transactions').insert({
      type: 'expense',
      description: `Pago tarjeta ${card.name}`,
      date: new Date().toISOString().slice(0, 10),
      amount_ars: total,
      amount_usd: 0,
      category_id: null,
      account_id: cuentaPago.id,
      card_id: null,
      is_paid: true,
    })
    setPagando(null)
    cargarTxns()
  }

  function parsearFecha(raw) {
    if (!raw) return new Date().toISOString().slice(0, 10)
    const partes = raw.trim().split(/[\/\-\s]/)[0] ? raw.trim().split(/[\/\-]/) : []
    if (partes.length >= 3) {
      if (partes[0].length === 4) return `${partes[0]}-${partes[1].padStart(2,'0')}-${partes[2].slice(0,2).padStart(2,'0')}`
      return `${partes[2]}-${partes[1].padStart(2,'0')}-${partes[0].padStart(2,'0')}`
    }
    return new Date().toISOString().slice(0, 10)
  }

  function parsearMonto(raw) {
    if (!raw) return 0
    const clean = raw.replace(/\s/g, '').replace(/\./g, '').replace(',', '.')
    return parseFloat(clean) || 0
  }

  // Importar CSV — soporta MP, Visa, Mastercard, Canadá, Patagonia
  async function importarCSV(e) {
    const file = e.target.files[0]
    if (!file) return
    e.target.value = ''
    setImportando(true)
    setImportMsg(null)

    const text = await file.text()
    const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim())
    if (lines.length < 2) { setImportMsg('Archivo vacío o inválido'); setImportando(false); return }

    const sep = lines[0].includes(';') ? ';' : ','
    const headers = lines[0].split(sep).map(h => h.replace(/"/g, '').trim().toLowerCase())

    // Mapeo de columnas según banco
    let iFecha = -1, iDesc = -1, iMonto = -1, iCredito = -1, iDebito = -1

    if (importBanco === 'mp') {
      iFecha  = headers.findIndex(h => h.includes('fecha'))
      iDesc   = headers.findIndex(h => h.includes('descripci') || h.includes('detalle') || h.includes('concepto'))
      iMonto  = headers.findIndex(h => h.includes('monto') || h.includes('importe'))
    } else if (importBanco === 'visa' || importBanco === 'mastercard') {
      iFecha  = headers.findIndex(h => h.includes('fecha'))
      iDesc   = headers.findIndex(h => h.includes('establecimiento') || h.includes('comercio') || h.includes('descripci') || h.includes('detalle'))
      iMonto  = headers.findIndex(h => h.includes('importe') || h.includes('monto') || h.includes('pesos'))
    } else if (importBanco === 'canada') {
      iFecha  = headers.findIndex(h => h.includes('fecha'))
      iDesc   = headers.findIndex(h => h.includes('descripci') || h.includes('concepto') || h.includes('detalle'))
      iCredito = headers.findIndex(h => h.includes('cr') || h.includes('crédito') || h.includes('haber'))
      iDebito  = headers.findIndex(h => h.includes('db') || h.includes('débito') || h.includes('debe'))
      iMonto  = headers.findIndex(h => h.includes('importe') || h.includes('monto'))
    } else if (importBanco === 'patagonia') {
      iFecha  = headers.findIndex(h => h.includes('fecha'))
      iDesc   = headers.findIndex(h => h.includes('descripci') || h.includes('concepto') || h.includes('movimiento'))
      iCredito = headers.findIndex(h => h.includes('crédito') || h.includes('haber'))
      iDebito  = headers.findIndex(h => h.includes('débito') || h.includes('debe'))
      iMonto  = headers.findIndex(h => h.includes('importe') || h.includes('monto'))
    }

    // Fallback genérico si no encontró por banco
    if (iFecha === -1) iFecha = headers.findIndex(h => h.includes('fecha'))
    if (iDesc  === -1) iDesc  = headers.findIndex(h => h.includes('descripci') || h.includes('detalle') || h.includes('concepto'))
    if (iMonto === -1) iMonto = headers.findIndex(h => h.includes('monto') || h.includes('importe') || h.includes('total'))

    if (iMonto === -1 && iCredito === -1) {
      setImportMsg('No se encontró columna de monto. Verificá el formato del archivo.')
      setImportando(false); return
    }

    const bancoConfig = {
      mp:         { nombre: 'Mercado Pago', buscar: a => a.name.toLowerCase().includes('mercado') },
      visa:       { nombre: 'Visa',         buscar: a => a.name.toLowerCase().includes('visa') },
      mastercard: { nombre: 'Mastercard',   buscar: a => a.name.toLowerCase().includes('master') },
      canada:     { nombre: 'Canadá',       buscar: a => a.name.toLowerCase().includes('canad') },
      patagonia:  { nombre: 'Patagonia',    buscar: a => a.name.toLowerCase().includes('patagonia') },
    }
    const cfg = bancoConfig[importBanco] || bancoConfig.mp
    const cuenta = accounts.find(cfg.buscar) || accounts[0]
    const catOtros = categories?.find(c => c.name === 'Otros')

    const txns = []
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(sep).map(c => c.replace(/"/g, '').trim())
      if (cols.length < 2) continue

      let monto = 0
      let tipo = 'expense'

      if (iCredito >= 0 && iDebito >= 0) {
        const cr = parsearMonto(cols[iCredito])
        const db = parsearMonto(cols[iDebito])
        if (cr > 0) { monto = cr; tipo = 'income' }
        else if (db > 0) { monto = db; tipo = 'expense' }
        else continue
      } else if (iMonto >= 0) {
        const raw = parsearMonto(cols[iMonto])
        monto = Math.abs(raw)
        tipo = raw < 0 ? 'expense' : 'income'
      }

      if (!monto || isNaN(monto)) continue

      const desc = iDesc >= 0 ? cols[iDesc] : `Movimiento ${cfg.nombre} ${i}`
      const fecha = parsearFecha(iFecha >= 0 ? cols[iFecha] : cols[0])

      txns.push({ type: tipo, description: desc, date: fecha, amount_ars: monto, amount_usd: 0, category_id: catOtros?.id || null, account_id: cuenta?.id || null, card_id: null })
    }

    if (txns.length === 0) { setImportMsg('No se encontraron movimientos válidos'); setImportando(false); return }

    const { error } = await supabase.from('transactions').insert(txns)
    if (error) setImportMsg(`Error: ${error.message}`)
    else setImportMsg(`✅ ${txns.length} movimientos de ${cfg.nombre} importados`)
    setImportando(false)
    cargarTxns()
  }

  if (loading) return <p className="text-center text-gray-400 mt-20">Cargando...</p>

  // Vista detalle de cuenta
  if (cuentaDetalle) {
    return (
      <div className="min-h-screen bg-gray-50 pb-24">
        <div className="max-w-md mx-auto p-4">
          <div className="flex items-center gap-3 mb-4">
            <button onClick={() => setCuentaDetalle(null)} className="p-2 rounded-full hover:bg-gray-200 text-gray-600">
              <ChevronRight size={22} className="rotate-180" />
            </button>
            <div className="flex-1">
              <h1 className="text-xl font-bold text-brand-600">{cuentaDetalle.name}</h1>
              <p className="text-xs text-gray-400">Últimos 50 movimientos</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400">Saldo</p>
              {(() => {
                const b = balances[cuentaDetalle.id] || { ars: 0, usd: 0 }
                const isUSD = cuentaDetalle.currency === 'USD'
                const monto = isUSD ? b.usd : b.ars
                return (
                  <p className={`text-base font-bold ${monto >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {isUSD ? fmtUSD(monto) : fmtARS(monto)}
                  </p>
                )
              })()}
            </div>
          </div>

          {loadingMovs ? (
            <p className="text-center text-gray-400 mt-10">Cargando...</p>
          ) : movsCuenta.length === 0 ? (
            <p className="text-center text-gray-400 mt-10">Sin movimientos</p>
          ) : (
            <div className="space-y-2">
              {movsCuenta.map(m => {
                const fechaObj = new Date(m.date + 'T00:00:00')
                return (
                  <div key={m.id} className="bg-white rounded-xl shadow-sm px-3 py-3 flex items-center gap-3">
                    <div className="shrink-0 w-10 text-center bg-gray-100 rounded-lg py-1">
                      <p className="text-sm font-bold text-gray-700 leading-none">{format(fechaObj, 'd')}</p>
                      <p className="text-xs text-gray-400 capitalize">{format(fechaObj, 'MMM', { locale: es })}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-800 text-sm truncate">{m.description}</p>
                      <p className="text-xs text-gray-400">{m.categories?.icon} {m.categories?.name || ''}</p>
                    </div>
                    <p className={`font-bold text-sm shrink-0 ${m.type === 'income' ? 'text-green-600' : 'text-gray-800'}`}>
                      {m.type === 'income' ? '+' : '-'}{fmtARS(m.amount_ars)}
                    </p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <div className="max-w-md mx-auto p-4">
        <h1 className="text-xl font-bold text-brand-600 mb-4">Cuentas y tarjetas</h1>

        {/* Cotización dólar */}
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400">Dólar blue</p>
            <p className="text-xl font-bold text-gray-800">{dolar ? `$${dolar.toLocaleString('es-AR')}` : '—'}</p>
          </div>
          <button onClick={actualizarDolar} disabled={loadingDolar}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-200 disabled:opacity-50">
            <RefreshCw size={14} className={loadingDolar ? 'animate-spin' : ''} />
            Actualizar
          </button>
        </div>

        {/* Patrimonio neto */}
        {(() => {
          const totalARS = accounts
            .filter(a => a.currency !== 'USD')
            .reduce((s, a) => s + (balances[a.id]?.ars || 0), 0)
          const totalUSDenARS = accounts
            .filter(a => a.currency === 'USD')
            .reduce((s, a) => s + (balances[a.id]?.usd || 0) * (dolar || 0), 0)
          const patrimonio = totalARS + totalUSDenARS
          return (
            <div className="bg-gradient-to-r from-brand-600 to-pink-500 rounded-2xl shadow-sm p-4 mb-4 text-white">
              <p className="text-xs opacity-80 mb-1">Patrimonio neto total</p>
              <p className="text-3xl font-bold">{fmtARS(patrimonio)}</p>
              <div className="flex gap-4 mt-2 text-xs opacity-80">
                <span>Cuentas ARS: {fmtARS(totalARS)}</span>
                {totalUSDenARS > 0 && <span>USD (blue): {fmtARS(totalUSDenARS)}</span>}
              </div>
            </div>
          )
        })()}

        {/* Importar MP */}
        <button onClick={() => setModalImport(true)}
          className="w-full mb-4 flex items-center justify-center gap-2 py-2.5 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-600 font-medium hover:bg-blue-100">
          <Upload size={15} /> Importar movimientos de Mercado Pago
        </button>

        {/* Cuentas */}
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Cuentas</h2>
        <div className="space-y-2 mb-6">
          {accounts.map(a => {
            const b = balances[a.id] || { ars: 0, usd: 0 }
            const isUSD = a.currency === 'USD'
            const monto = isUSD ? b.usd : b.ars
            const enARS = isUSD && dolar ? b.usd * dolar : null
            return (
              <button key={a.id} onClick={() => verMovimientosCuenta(a)}
                className="w-full bg-white rounded-xl shadow-sm px-4 py-3 flex items-center gap-3 hover:bg-gray-50 text-left">
                <span className="text-2xl">{TIPO_ICON[a.type] || '💳'}</span>
                <div className="flex-1">
                  <p className="font-semibold text-gray-800 text-sm">{a.name}</p>
                  <p className="text-xs text-gray-400">{TIPO_LABEL[a.type] || a.type}</p>
                </div>
                <div className="text-right mr-1">
                  <p className={`font-bold text-sm ${monto >= 0 ? 'text-gray-800' : 'text-red-500'}`}>
                    {isUSD ? fmtUSD(monto) : fmtARS(monto)}
                  </p>
                  {enARS && <p className="text-xs text-gray-400">≈ {fmtARS(enARS)}</p>}
                </div>
                <ChevronRight size={16} className="text-gray-300 shrink-0" />
              </button>
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
                </div>
                {pendiente > 0 && (
                  <button onClick={() => pagarTarjeta(c)} disabled={isPagando}
                    className="shrink-0 flex items-center gap-1 px-3 py-1.5 bg-green-500 text-white text-xs font-semibold rounded-xl hover:bg-green-600 disabled:opacity-50">
                    <CheckCircle size={14} />
                    {isPagando ? '...' : 'Pagar'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Modal pagar tarjeta */}
      {modalPago && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setModalPago(null)}>
          <div className="bg-white w-full max-w-md rounded-t-2xl p-5 pb-8" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-lg font-bold text-gray-800">Pagar {modalPago.card.name}</h2>
              <button onClick={() => setModalPago(null)}><X size={20} className="text-gray-400" /></button>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Total a pagar: <span className="font-bold text-red-500">{fmtARS(modalPago.total)}</span>
            </p>
            <p className="text-xs text-gray-500 font-medium mb-2">¿Desde qué cuenta?</p>
            <div className="space-y-2">
              {accounts.map(a => (
                <button key={a.id} onClick={() => confirmarPago(a)}
                  className="w-full flex items-center gap-3 bg-gray-50 hover:bg-brand-50 hover:border-brand-300 border border-gray-200 rounded-xl px-4 py-3 transition-colors">
                  <span className="text-xl">{TIPO_ICON[a.type] || '💳'}</span>
                  <div className="flex-1 text-left">
                    <p className="font-semibold text-gray-800 text-sm">{a.name}</p>
                    <p className="text-xs text-gray-400">{fmtARS(balances[a.id]?.ars || 0)} disponible</p>
                  </div>
                  <CheckCircle size={18} className="text-gray-300" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal importar CSV */}
      {modalImport && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setModalImport(false)}>
          <div className="bg-white w-full max-w-md rounded-t-2xl p-5 pb-8" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-gray-800">Importar {
                { mp: 'Mercado Pago', visa: 'Visa', mastercard: 'Mastercard', canada: 'Canadá', patagonia: 'Patagonia' }[importBanco]
              }</h2>
              <button onClick={() => setModalImport(false)}><X size={20} className="text-gray-400" /></button>
            </div>
            <div className="mb-4">
              <p className="text-xs text-gray-500 font-medium mb-2">¿De qué banco es el archivo?</p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'mp', label: '🟦 Mercado Pago' },
                  { id: 'visa', label: '💳 Visa' },
                  { id: 'mastercard', label: '💳 Mastercard' },
                  { id: 'canada', label: '🏦 Canadá' },
                  { id: 'patagonia', label: '🏦 Patagonia' },
                ].map(b => (
                  <button key={b.id} onClick={() => setImportBanco(b.id)}
                    className={`py-2 px-2 rounded-xl text-xs font-medium border transition-colors ${importBanco === b.id ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                    {b.label}
                  </button>
                ))}
              </div>
            </div>
            <label className={`w-full flex flex-col items-center justify-center gap-2 py-8 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:border-brand-400 hover:bg-brand-50 transition-colors ${importando ? 'opacity-50 pointer-events-none' : ''}`}>
              <Upload size={24} className="text-gray-400" />
              <p className="text-sm text-gray-500 font-medium">{importando ? 'Importando...' : 'Tocar para seleccionar el archivo CSV'}</p>
              <input type="file" accept=".csv" className="hidden" onChange={importarCSV} />
            </label>
            {importMsg && (
              <p className={`mt-3 text-sm px-3 py-2 rounded-xl ${importMsg.startsWith('✅') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                {importMsg}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
