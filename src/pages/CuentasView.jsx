import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtARS, fmtUSD } from '../lib/formato'
import { RefreshCw, CheckCircle, ChevronRight, X, Upload, FileText, Eye } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import * as pdfjsLib from 'pdfjs-dist'
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href

const TIPO_ICON = { bank: '🏦', wallet: '📱', cash: '💵', other: '📦' }
const TIPO_LABEL = { bank: 'Banco', wallet: 'Billetera', cash: 'Efectivo', other: 'Otro' }

export default function CuentasView({ accounts, cards, categories, darkMode, toggleDark }) {
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
  const [importBanco, setImportBanco] = useState('patagonia')
  const [preview, setPreview] = useState(null) // { txns, fileName }
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
        const updatedMs = updated ? new Date(updated).getTime() : 0
        const stale = !updatedMs || isNaN(updatedMs) || (Date.now() - updatedMs) > 3600000
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

  const BANCO_CFG = {
    mp:         { nombre: 'Mercado Pago', buscarCuenta: a => a.name.toLowerCase().includes('mercado') },
    visa:       { nombre: 'Visa',         buscarCuenta: a => a.name.toLowerCase().includes('visa'), esCard: true },
    mastercard: { nombre: 'Mastercard',   buscarCuenta: a => a.name.toLowerCase().includes('master'), esCard: true },
    patagonia:  { nombre: 'Patagonia',    buscarCuenta: a => a.name.toLowerCase().includes('patagonia') },
    canada:     { nombre: 'Canadá',       buscarCuenta: a => a.name.toLowerCase().includes('canad') },
  }

  function parsearFecha(raw) {
    if (!raw) return new Date().toISOString().slice(0, 10)
    const partes = raw.trim().split(/[\/\-]/)
    if (partes.length >= 3) {
      if (partes[0].length === 4) return `${partes[0]}-${partes[1].padStart(2,'0')}-${partes[2].slice(0,2).padStart(2,'0')}`
      return `${partes[2].length === 4 ? partes[2] : '20' + partes[2]}-${partes[1].padStart(2,'0')}-${partes[0].padStart(2,'0')}`
    }
    return new Date().toISOString().slice(0, 10)
  }

  function parsearMonto(raw) {
    if (!raw) return 0
    const clean = String(raw).replace(/\s/g, '').replace(/\$/g,'').replace(/\./g, '').replace(',', '.')
    return parseFloat(clean) || 0
  }

  // ── Parsear texto de PDF (formato Banco Patagonia y genérico) ──
  function parsearTextoPDF(fullText) {
    const catOtros = categories?.find(c => c.name?.toLowerCase().includes('otro'))
    const cfg = BANCO_CFG[importBanco] || BANCO_CFG.patagonia
    const cuentaAcc = accounts.find(cfg.buscarCuenta) || accounts[0]
    const cardObj = cfg.esCard ? cards?.find(c => c.name.toLowerCase().includes(importBanco === 'visa' ? 'visa' : 'master')) : null

    const txns = []
    const lines = fullText.split('\n').map(l => l.trim()).filter(Boolean)

    // Patrón de fecha DD/MM/YYYY o DD/MM/YY al inicio de línea
    const reFecha = /^(\d{2}\/\d{2}\/\d{2,4})/
    // Patrón de monto al final: números con puntos/comas
    const reMonto = /([\d.,]+)\s*$/

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const fechaMatch = line.match(reFecha)
      if (!fechaMatch) continue

      const fecha = parsearFecha(fechaMatch[1])
      // El resto de la línea después de la fecha
      let resto = line.slice(fechaMatch[0].length).trim()

      // Buscar monto al final
      const montoMatch = resto.match(reMonto)
      if (!montoMatch) continue

      const monto = parsearMonto(montoMatch[1])
      if (!monto || isNaN(monto) || monto < 1) continue

      // Descripción = todo entre la fecha y el monto
      let desc = resto.slice(0, resto.lastIndexOf(montoMatch[1])).trim()
      // Limpiar signos, puntos extras
      desc = desc.replace(/^[-–]/, '').replace(/\s{2,}/g, ' ').trim()
      if (!desc) desc = `Movimiento ${cfg.nombre}`

      // Determinar tipo: buscar indicadores de crédito en la línea o siguiente
      const lineaLower = line.toLowerCase()
      const tipo = (lineaLower.includes('acredit') || lineaLower.includes('crédito') ||
                    lineaLower.includes('credit') || lineaLower.includes('haber') ||
                    lineaLower.includes('transferencia recibida') || lineaLower.includes('depósito'))
                    ? 'income' : 'expense'

      txns.push({
        type: tipo,
        description: desc,
        date: fecha,
        amount_ars: monto,
        amount_usd: 0,
        category_id: catOtros?.id || null,
        account_id: cardObj ? null : (cuentaAcc?.id || null),
        card_id: cardObj?.id || null,
      })
    }
    return txns
  }

  // ── Parsear CSV ──
  function parsearCSV(text) {
    const catOtros = categories?.find(c => c.name?.toLowerCase().includes('otro'))
    const cfg = BANCO_CFG[importBanco] || BANCO_CFG.mp
    const cuentaAcc = accounts.find(cfg.buscarCuenta) || accounts[0]
    const cardObj = cfg.esCard ? cards?.find(c => c.name.toLowerCase().includes(importBanco === 'visa' ? 'visa' : 'master')) : null

    const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim())
    if (lines.length < 2) return []

    const sep = lines[0].includes(';') ? ';' : ','
    const headers = lines[0].split(sep).map(h => h.replace(/"/g, '').trim().toLowerCase())

    let iFecha = -1, iDesc = -1, iMonto = -1, iCredito = -1, iDebito = -1
    iFecha   = headers.findIndex(h => h.includes('fecha'))
    iDesc    = headers.findIndex(h => ['descripci','detalle','concepto','establecimiento','comercio','movimiento'].some(k => h.includes(k)))
    iCredito = headers.findIndex(h => ['crédito','credito','haber','cr '].some(k => h.includes(k)))
    iDebito  = headers.findIndex(h => ['débito','debito','debe','db '].some(k => h.includes(k)))
    iMonto   = headers.findIndex(h => ['monto','importe','total','pesos','amount'].some(k => h.includes(k)))

    const txns = []
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(sep).map(c => c.replace(/"/g, '').trim())
      if (cols.length < 2) continue

      let monto = 0, tipo = 'expense'
      if (iCredito >= 0 && iDebito >= 0) {
        const cr = parsearMonto(cols[iCredito])
        const db = parsearMonto(cols[iDebito])
        if (cr > 0) { monto = cr; tipo = 'income' }
        else if (db > 0) { monto = db }
        else continue
      } else if (iMonto >= 0) {
        const raw = parsearMonto(cols[iMonto])
        monto = Math.abs(raw)
        tipo = raw < 0 ? 'expense' : 'income'
      }
      if (!monto || isNaN(monto)) continue

      const desc = iDesc >= 0 ? cols[iDesc] : `Movimiento ${i}`
      const fecha = parsearFecha(iFecha >= 0 ? cols[iFecha] : cols[0])

      txns.push({
        type: tipo, description: desc, date: fecha,
        amount_ars: monto, amount_usd: 0,
        category_id: catOtros?.id || null,
        account_id: cardObj ? null : (cuentaAcc?.id || null),
        card_id: cardObj?.id || null,
      })
    }
    return txns
  }

  // ── Manejador principal del input de archivo ──
  async function onArchivoSeleccionado(e) {
    const file = e.target.files[0]
    if (!file) return
    e.target.value = ''
    setImportando(true)
    setImportMsg(null)
    setPreview(null)

    try {
      let txns = []

      if (file.name.toLowerCase().endsWith('.pdf')) {
        // ── PDF ──
        const arrayBuffer = await file.arrayBuffer()
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
        let fullText = ''
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p)
          const content = await page.getTextContent()
          // Reconstruir líneas agrupando por Y aproximado
          const items = content.items
          const lineMap = {}
          items.forEach(item => {
            const y = Math.round(item.transform[5])
            if (!lineMap[y]) lineMap[y] = []
            lineMap[y].push(item.str)
          })
          const sortedYs = Object.keys(lineMap).map(Number).sort((a,b) => b - a)
          sortedYs.forEach(y => { fullText += lineMap[y].join(' ') + '\n' })
        }
        txns = parsearTextoPDF(fullText)
      } else {
        // ── CSV ──
        const text = await file.text()
        txns = parsearCSV(text)
      }

      if (txns.length === 0) {
        setImportMsg('No se encontraron movimientos válidos en el archivo.')
      } else {
        setPreview({ txns, fileName: file.name })
      }
    } catch (err) {
      setImportMsg(`Error al leer el archivo: ${err.message}`)
    }
    setImportando(false)
  }

  async function confirmarImport() {
    if (!preview?.txns?.length) return
    setImportando(true)
    const { error } = await supabase.from('transactions').insert(preview.txns)
    if (error) {
      setImportMsg(`Error: ${error.message}`)
    } else {
      setImportMsg(`✅ ${preview.txns.length} movimientos importados correctamente`)
      setPreview(null)
      cargarTxns()
    }
    setImportando(false)
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
          const totalUSDenARS = dolar
            ? accounts.filter(a => a.currency === 'USD').reduce((s, a) => s + (balances[a.id]?.usd || 0) * dolar, 0)
            : 0
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

        {/* Importar extracto */}
        <button onClick={() => { setModalImport(true); setPreview(null); setImportMsg(null) }}
          className="w-full mb-4 flex items-center justify-center gap-2 py-2.5 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-600 font-medium hover:bg-blue-100">
          <Upload size={15} /> Importar extracto bancario (PDF o CSV)
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

      {/* Modal importar PDF/CSV */}
      {modalImport && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => { setModalImport(false); setPreview(null); setImportMsg(null) }}>
          <div className="bg-white w-full max-w-md rounded-t-2xl p-5 pb-8 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-gray-800">
                {preview ? `Vista previa — ${preview.txns.length} movimientos` : 'Importar extracto bancario'}
              </h2>
              <button onClick={() => { setModalImport(false); setPreview(null); setImportMsg(null) }}>
                <X size={20} className="text-gray-400" />
              </button>
            </div>

            {!preview ? (
              <>
                {/* Selector de banco */}
                <div className="mb-4">
                  <p className="text-xs text-gray-500 font-medium mb-2">¿De qué banco es el archivo?</p>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'patagonia',  label: '🏦 Patagonia' },
                      { id: 'mp',         label: '🟦 Mercado Pago' },
                      { id: 'visa',       label: '💳 Visa' },
                      { id: 'mastercard', label: '💳 Mastercard' },
                      { id: 'canada',     label: '🍁 Canadá' },
                    ].map(b => (
                      <button key={b.id} onClick={() => setImportBanco(b.id)}
                        className={`py-2 px-2 rounded-xl text-xs font-medium border transition-colors ${importBanco === b.id ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                        {b.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Drop zone PDF/CSV */}
                <label className={`w-full flex flex-col items-center justify-center gap-3 py-10 border-2 border-dashed border-gray-200 rounded-2xl cursor-pointer hover:border-brand-400 hover:bg-brand-50 transition-colors ${importando ? 'opacity-50 pointer-events-none' : ''}`}>
                  {importando ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-8 h-8 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" />
                      <p className="text-sm text-gray-500">Leyendo archivo...</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex gap-3">
                        <div className="flex items-center gap-1.5 bg-red-50 text-red-500 px-3 py-1.5 rounded-lg text-xs font-semibold">
                          <FileText size={14} /> PDF
                        </div>
                        <div className="flex items-center gap-1.5 bg-green-50 text-green-600 px-3 py-1.5 rounded-lg text-xs font-semibold">
                          <FileText size={14} /> CSV
                        </div>
                      </div>
                      <p className="text-sm text-gray-500 font-medium">Tocar para seleccionar el extracto</p>
                      <p className="text-xs text-gray-400">El banco te lo da en PDF o CSV</p>
                    </>
                  )}
                  <input type="file" accept=".csv,.pdf" className="hidden" onChange={onArchivoSeleccionado} />
                </label>

                {importMsg && (
                  <p className={`mt-3 text-sm px-3 py-2 rounded-xl ${importMsg.startsWith('✅') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                    {importMsg}
                  </p>
                )}
              </>
            ) : (
              <>
                {/* Vista previa de transacciones parseadas */}
                <div className="flex items-center gap-2 mb-3 text-xs text-gray-400">
                  <Eye size={13} />
                  <span>Revisá antes de importar. Podés cancelar si algo no cuadra.</span>
                </div>

                <div className="space-y-1.5 max-h-[50vh] overflow-y-auto mb-4 pr-1">
                  {preview.txns.map((t, i) => (
                    <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
                      <span className={`text-xs font-bold w-3 ${t.type === 'income' ? 'text-green-500' : 'text-red-400'}`}>
                        {t.type === 'income' ? '+' : '-'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-700 truncate">{t.description}</p>
                        <p className="text-xs text-gray-400">{t.date}</p>
                      </div>
                      <p className="text-xs font-semibold text-gray-700 shrink-0 tabular-nums">
                        {fmtARS(t.amount_ars)}
                      </p>
                    </div>
                  ))}
                </div>

                {importMsg && (
                  <p className={`mb-3 text-sm px-3 py-2 rounded-xl ${importMsg.startsWith('✅') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                    {importMsg}
                  </p>
                )}

                <div className="flex gap-2">
                  <button onClick={() => { setPreview(null); setImportMsg(null) }}
                    className="flex-1 py-3 rounded-xl border border-gray-200 text-sm text-gray-600 font-medium">
                    ← Volver
                  </button>
                  <button onClick={confirmarImport} disabled={importando}
                    className="flex-1 py-3 rounded-xl bg-brand-600 text-white text-sm font-semibold disabled:opacity-50">
                    {importando ? 'Importando...' : `Importar ${preview.txns.length} movimientos`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Ajustes */}
      {!cuentaDetalle && (
        <div className="max-w-md mx-auto px-4 pb-2 mt-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2 px-1">Ajustes</p>
          <div className="bg-white rounded-2xl shadow-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3.5">
              <div className="flex items-center gap-3">
                <span className="text-xl">{darkMode ? '🌙' : '☀️'}</span>
                <div>
                  <p className="text-sm font-medium text-gray-800">Modo oscuro</p>
                  <p className="text-xs text-gray-400">{darkMode ? 'Activado' : 'Desactivado'}</p>
                </div>
              </div>
              <button onClick={toggleDark} className="flex items-center">
                <div className={`w-12 h-6 rounded-full transition-colors duration-300 flex items-center px-0.5 ${darkMode ? 'bg-brand-600' : 'bg-gray-300'}`}>
                  <div className={`w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-300 ${darkMode ? 'translate-x-6' : 'translate-x-0'}`} />
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
