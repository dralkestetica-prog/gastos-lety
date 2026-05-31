import { useState } from 'react'
import { X, Upload, FileText, CheckCircle, AlertCircle, HelpCircle, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fmtARS, fmtUSD } from '../lib/formato'
import * as pdfjsLib from 'pdfjs-dist'
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href

// ─── Parseo ────────────────────────────────────────────────────────────────

function parsearFecha(raw) {
  if (!raw) return null
  const p = raw.trim().split(/[\/\-]/)
  if (p.length < 3) return null
  if (p[0].length === 4) return `${p[0]}-${p[1].padStart(2,'0')}-${p[2].slice(0,2).padStart(2,'0')}`
  const y = p[2].length === 2 ? '20' + p[2] : p[2]
  return `${y}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`
}

function parsearMonto(raw) {
  if (!raw) return 0
  return parseFloat(String(raw).replace(/\s/g,'').replace(/\$/g,'').replace(/\./g,'').replace(',','.')) || 0
}

async function extraerTxnsDeArchivo(file) {
  if (file.name.toLowerCase().endsWith('.pdf')) {
    const buf = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise
    let fullText = ''
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p)
      const content = await page.getTextContent()
      const lineMap = {}
      content.items.forEach(item => {
        const y = Math.round(item.transform[5])
        if (!lineMap[y]) lineMap[y] = []
        lineMap[y].push(item.str)
      })
      Object.keys(lineMap).map(Number).sort((a,b) => b-a)
        .forEach(y => { fullText += lineMap[y].join(' ') + '\n' })
    }
    return { txns: parsearTextoPDF(fullText), debug: fullText.slice(0, 6000) }
  } else {
    const text = await file.text()
    return { txns: parsearCSV(text), debug: text.slice(0, 6000) }
  }
}

function inferirAnio(texto) {
  // Buscar año en el texto del PDF (ej: "MAYO 2026", "05/2026", "2026")
  const m = texto.match(/20(2[4-9]|3\d)/)
  return m ? parseInt(m[0]) : new Date().getFullYear()
}

function parsearTextoPDF(fullText) {
  const txns = []
  const anio = inferirAnio(fullText)
  const lines = fullText.split('\n').map(l => l.trim()).filter(Boolean)

  // Patrones de fecha: DD/MM/YYYY, DD/MM/YY, o solo DD/MM (Patagonia Visa)
  const reFechaLarga = /(\d{2}\/\d{2}\/\d{2,4})/
  const reFechaCorta = /^(\d{2}\/\d{2})\b/    // DD/MM al inicio de línea
  // Monto al final: puede ser 1.234,56 o 1234,56 o -1.234,56
  const reMonto = /(-?[\d.]+,\d{2})\s*$/

  for (const line of lines) {
    // Ignorar líneas de totales/encabezados
    const lineL = line.toLowerCase()
    if (lineL.includes('total') && !lineL.match(/\d{2}\/\d{2}/)) continue
    if (lineL.includes('saldo') && !lineL.match(/\d{2}\/\d{2}/)) continue
    if (lineL.includes('pagina') || lineL.includes('página')) continue

    // Intentar fecha larga primero, luego corta
    let fechaStr = null
    let restoDesde = 0
    const mLarga = line.match(reFechaLarga)
    const mCorta = line.match(reFechaCorta)

    if (mLarga) {
      fechaStr = parsearFecha(mLarga[1])
      restoDesde = line.indexOf(mLarga[1]) + mLarga[1].length
    } else if (mCorta) {
      // DD/MM sin año → usar año inferido
      const [dd, mm] = mCorta[1].split('/')
      fechaStr = `${anio}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`
      restoDesde = mCorta[1].length
    }

    if (!fechaStr) continue

    const resto = line.slice(restoDesde).trim()
    const montoMatch = resto.match(reMonto)
    if (!montoMatch) continue

    const montoRaw = parsearMonto(montoMatch[1])
    const monto = Math.abs(montoRaw)
    if (!monto || monto < 1) continue

    let desc = resto.slice(0, resto.lastIndexOf(montoMatch[1])).trim()
    // Limpiar cuotas (ej: "01/06" al final de la descripción)
    desc = desc.replace(/\s+\d{2}\/\d{2}\s*$/, '').trim()
    if (!desc) desc = 'Movimiento'

    // Tipo: crédito si el monto es negativo en el PDF o si hay palabras clave
    const tipo = (montoRaw < 0 ||
      lineL.includes('acredit') || lineL.includes('haber') ||
      lineL.includes('pago tarjeta') || lineL.includes('pago recibido') ||
      lineL.includes('depósito') || lineL.includes('deposito') ||
      lineL.includes('transf. recib')) ? 'income' : 'expense'

    txns.push({ date: fechaStr, description: desc, amount_ars: monto, type: tipo })
  }
  return txns
}

function parsearCSV(text) {
  const lines = text.replace(/\r/g,'').split('\n').filter(l => l.trim())
  if (lines.length < 2) return []
  const sep = lines[0].includes(';') ? ';' : ','
  const headers = lines[0].split(sep).map(h => h.replace(/"/g,'').trim().toLowerCase())
  const iFecha   = headers.findIndex(h => h.includes('fecha'))
  const iDesc    = headers.findIndex(h => ['descripci','detalle','concepto','establecimiento'].some(k => h.includes(k)))
  const iCredito = headers.findIndex(h => ['crédito','credito','haber'].some(k => h.includes(k)))
  const iDebito  = headers.findIndex(h => ['débito','debito','debe'].some(k => h.includes(k)))
  const iMonto   = headers.findIndex(h => ['monto','importe','total','pesos'].some(k => h.includes(k)))

  const txns = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(sep).map(c => c.replace(/"/g,'').trim())
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
    const fecha = parsearFecha(iFecha >= 0 ? cols[iFecha] : cols[0])
    if (!fecha) continue
    const desc = iDesc >= 0 ? cols[iDesc] : `Movimiento ${i}`
    txns.push({ date: fecha, description: desc, amount_ars: monto, type: tipo })
  }
  return txns
}

// ─── Algoritmo de matching ─────────────────────────────────────────────────

function matchearTransacciones(bancoParsed, appTxns) {
  const usados = new Set()
  const matched = []
  const soloEnBanco = []

  for (const b of bancoParsed) {
    const bFecha = new Date(b.date).getTime()
    // Buscar en app: mismo monto (±1%) y fecha ±4 días
    let mejor = null
    let mejorScore = -1
    for (let i = 0; i < appTxns.length; i++) {
      if (usados.has(i)) continue
      const a = appTxns[i]
      const aFecha = new Date(a.date).getTime()
      const diffDias = Math.abs(bFecha - aFecha) / 86400000
      const diffMonto = Math.abs(b.amount_ars - Number(a.amount_ars)) / Math.max(b.amount_ars, 1)
      if (diffDias <= 4 && diffMonto < 0.02) {
        const score = 10 - diffDias - diffMonto * 10
        if (score > mejorScore) { mejorScore = score; mejor = i }
      }
    }
    if (mejor !== null) {
      usados.add(mejor)
      matched.push({ banco: b, app: appTxns[mejor] })
    } else {
      soloEnBanco.push(b)
    }
  }

  const soloEnApp = appTxns.filter((_, i) => !usados.has(i))
  return { matched, soloEnBanco, soloEnApp }
}

// ─── Componente ────────────────────────────────────────────────────────────

const BANCOS = [
  { id: 'patagonia',  label: '🏦 Patagonia',    acc: a => a.name.toLowerCase().includes('patagonia') },
  { id: 'mp',         label: '🟦 Mercado Pago',  acc: a => a.name.toLowerCase().includes('mercado') },
  { id: 'visa',       label: '💳 Visa',           acc: a => a.name.toLowerCase().includes('visa'), esCard: true },
  { id: 'mastercard', label: '💳 Mastercard',     acc: a => a.name.toLowerCase().includes('master'), esCard: true },
  { id: 'canada',     label: '🍁 Canadá',         acc: a => a.name.toLowerCase().includes('canad') },
]

export default function ConciliacionModal({ onClose, accounts, categories, cards }) {
  const [step, setStep] = useState('upload')    // upload | resultado | done
  const [banco, setBanco] = useState('patagonia')
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(null)
  const [rawText, setRawText] = useState(null)

  // Resultado del análisis
  const [matched, setMatched]         = useState([])
  const [soloEnBanco, setSoloEnBanco] = useState([])
  const [soloEnApp, setSoloEnApp]     = useState([])
  const [periodo, setPeriodo]         = useState('')
  const [seleccionados, setSeleccionados] = useState(new Set())
  const [importando, setImportando]   = useState(false)
  const [importMsg, setImportMsg]     = useState(null)

  async function onArchivo(e) {
    const file = e.target.files[0]
    if (!file) return
    e.target.value = ''
    setCargando(true)
    setError(null)

    try {
      // 1. Parsear archivo del banco
      const { txns: bancoParsed, debug } = await extraerTxnsDeArchivo(file)
      if (bancoParsed.length === 0) {
        setRawText(debug)
        setError('No se encontraron movimientos. Mostrando texto extraído del archivo para diagnóstico ↓')
        setCargando(false)
        return
      }
      setRawText(null)

      // 2. Detectar período del extracto
      const fechas = bancoParsed.map(t => t.date).sort()
      const desde = fechas[0]
      const hasta = fechas[fechas.length - 1]
      setPeriodo(`${desde} al ${hasta}`)

      // 3. Cargar transacciones de la app para ese período y cuenta
      const bancoCfg = BANCOS.find(b => b.id === banco)
      const cuentaObj = accounts.find(bancoCfg.acc)
      const cardObj   = bancoCfg.esCard ? cards?.find(c => c.name.toLowerCase().includes(banco === 'visa' ? 'visa' : banco === 'mastercard' ? 'master' : '')) : null

      let query = supabase.from('transactions')
        .select('id, date, description, amount_ars, amount_usd, type')
        .gte('date', desde)
        .lte('date', hasta)
        .order('date')

      if (cardObj) query = query.eq('card_id', cardObj.id)
      else if (cuentaObj) query = query.eq('account_id', cuentaObj.id)

      const { data: appTxns } = await query

      // 4. Cruzar
      const resultado = matchearTransacciones(bancoParsed, appTxns || [])
      setMatched(resultado.matched)
      setSoloEnBanco(resultado.soloEnBanco)
      setSoloEnApp(resultado.soloEnApp)
      setSeleccionados(new Set(resultado.soloEnBanco.map((_, i) => i)))
      setStep('resultado')
    } catch (err) {
      setError(`Error: ${err.message}`)
    }
    setCargando(false)
  }

  async function importarFaltantes() {
    if (seleccionados.size === 0) return
    setImportando(true)
    const bancoCfg = BANCOS.find(b => b.id === banco)
    const cuentaObj = accounts.find(bancoCfg.acc)
    const cardObj   = bancoCfg.esCard ? cards?.find(c => c.name.toLowerCase().includes(banco === 'visa' ? 'visa' : 'master')) : null
    const catOtros  = categories?.find(c => c.name?.toLowerCase().includes('otro'))

    const txns = soloEnBanco
      .filter((_, i) => seleccionados.has(i))
      .map(t => ({
        type: t.type,
        description: t.description,
        date: t.date,
        amount_ars: t.amount_ars,
        amount_usd: 0,
        category_id: catOtros?.id || null,
        account_id: cardObj ? null : (cuentaObj?.id || null),
        card_id: cardObj?.id || null,
      }))

    const { error: err } = await supabase.from('transactions').insert(txns)
    if (err) {
      setImportMsg(`Error: ${err.message}`)
    } else {
      setImportMsg(`✅ ${txns.length} movimientos importados`)
      setStep('done')
    }
    setImportando(false)
  }

  function toggleSel(i) {
    setSeleccionados(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  const totalFaltante = soloEnBanco
    .filter((_, i) => seleccionados.has(i))
    .reduce((s, t) => s + t.amount_ars, 0)

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-12 pb-3 border-b border-gray-100">
        <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100 text-gray-500">
          <X size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-base font-bold text-gray-800">
            {step === 'upload' ? 'Conciliar cuenta' :
             step === 'resultado' ? 'Resultado de conciliación' :
             '✅ Conciliación completada'}
          </h1>
          {periodo && <p className="text-xs text-gray-400">{periodo}</p>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-32">

        {/* ── PASO 1: UPLOAD ── */}
        {step === 'upload' && (
          <div className="p-4 space-y-4">
            <p className="text-sm text-gray-500">
              Subí el extracto del banco y la app lo cruza automáticamente contra lo que ya tenés cargado.
            </p>

            {/* Selector banco */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">¿Qué cuenta conciliás?</p>
              <div className="grid grid-cols-2 gap-2">
                {BANCOS.map(b => (
                  <button key={b.id} onClick={() => setBanco(b.id)}
                    className={`py-3 px-3 rounded-xl text-sm font-medium border transition-colors text-left ${banco === b.id ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-700 border-gray-200'}`}>
                    {b.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Drop zone */}
            <label className={`flex flex-col items-center justify-center gap-3 py-12 border-2 border-dashed border-gray-200 rounded-2xl cursor-pointer hover:border-brand-400 hover:bg-brand-50 transition-colors ${cargando ? 'opacity-50 pointer-events-none' : ''}`}>
              {cargando ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="w-8 h-8 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm text-gray-500">Analizando extracto...</p>
                </div>
              ) : (
                <>
                  <div className="flex gap-3">
                    <span className="flex items-center gap-1.5 bg-red-50 text-red-500 px-3 py-1.5 rounded-lg text-xs font-semibold">
                      <FileText size={13} /> PDF
                    </span>
                    <span className="flex items-center gap-1.5 bg-green-50 text-green-600 px-3 py-1.5 rounded-lg text-xs font-semibold">
                      <FileText size={13} /> CSV
                    </span>
                  </div>
                  <p className="text-sm font-medium text-gray-600">Tocar para subir el extracto</p>
                  <p className="text-xs text-gray-400">El banco te lo da en PDF o CSV</p>
                </>
              )}
              <input type="file" accept=".pdf,.csv" className="hidden" onChange={onArchivo} />
            </label>

            {error && <p className="text-sm text-red-500 bg-red-50 rounded-xl px-3 py-2">{error}</p>}
            {rawText && (
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs font-semibold text-gray-500 mb-1">Texto extraído del PDF (primeras líneas):</p>
                <pre className="text-xs text-gray-600 whitespace-pre-wrap break-all overflow-y-auto max-h-48">{rawText}</pre>
              </div>
            )}
          </div>
        )}

        {/* ── PASO 2: RESULTADO ── */}
        {step === 'resultado' && (
          <div className="p-4 space-y-4">

            {/* Resumen */}
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-green-50 rounded-xl p-3 text-center">
                <CheckCircle size={18} className="text-green-500 mx-auto mb-1" />
                <p className="text-xl font-bold text-green-600">{matched.length}</p>
                <p className="text-xs text-green-600">Coinciden</p>
              </div>
              <div className="bg-red-50 rounded-xl p-3 text-center">
                <AlertCircle size={18} className="text-red-400 mx-auto mb-1" />
                <p className="text-xl font-bold text-red-500">{soloEnBanco.length}</p>
                <p className="text-xs text-red-500">Faltan en app</p>
              </div>
              <div className="bg-yellow-50 rounded-xl p-3 text-center">
                <HelpCircle size={18} className="text-yellow-500 mx-auto mb-1" />
                <p className="text-xl font-bold text-yellow-600">{soloEnApp.length}</p>
                <p className="text-xs text-yellow-600">Solo en app</p>
              </div>
            </div>

            {/* Faltan en app → para importar */}
            {soloEnBanco.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-red-500 uppercase tracking-wide">
                    ⚠️ Faltan en la app — seleccioná los que querés agregar
                  </p>
                  <button onClick={() => setSeleccionados(
                    seleccionados.size === soloEnBanco.length ? new Set() : new Set(soloEnBanco.map((_,i) => i))
                  )} className="text-xs text-brand-600 font-medium">
                    {seleccionados.size === soloEnBanco.length ? 'Deselec. todo' : 'Sel. todo'}
                  </button>
                </div>
                <div className="space-y-1.5">
                  {soloEnBanco.map((t, i) => (
                    <button key={i} onClick={() => toggleSel(i)}
                      className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 border transition-colors text-left ${seleccionados.has(i) ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-100 opacity-50'}`}>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${seleccionados.has(i) ? 'bg-brand-600 border-brand-600' : 'border-gray-300'}`}>
                        {seleccionados.has(i) && <div className="w-2 h-2 bg-white rounded-full" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-700 truncate">{t.description}</p>
                        <p className="text-xs text-gray-400">{t.date}</p>
                      </div>
                      <p className={`text-xs font-bold shrink-0 tabular-nums ${t.type === 'income' ? 'text-green-600' : 'text-red-500'}`}>
                        {t.type === 'income' ? '+' : '-'}{fmtARS(t.amount_ars)}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Solo en app */}
            {soloEnApp.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-yellow-600 uppercase tracking-wide mb-2">
                  ❓ Están en la app pero no en el banco
                </p>
                <div className="space-y-1.5">
                  {soloEnApp.map((t, i) => (
                    <div key={i} className="flex items-center gap-3 bg-yellow-50 border border-yellow-100 rounded-xl px-3 py-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-700 truncate">{t.description}</p>
                        <p className="text-xs text-gray-400">{t.date}</p>
                      </div>
                      <p className="text-xs font-bold shrink-0 tabular-nums text-gray-600">
                        {fmtARS(t.amount_ars)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Coinciden (colapsado) */}
            {matched.length > 0 && (
              <details className="group">
                <summary className="text-xs font-semibold text-green-600 uppercase tracking-wide cursor-pointer list-none flex items-center gap-1">
                  <ChevronRight size={13} className="group-open:rotate-90 transition-transform" />
                  ✅ {matched.length} movimientos que ya coinciden
                </summary>
                <div className="space-y-1.5 mt-2">
                  {matched.map((m, i) => (
                    <div key={i} className="flex items-center gap-3 bg-green-50 border border-green-100 rounded-xl px-3 py-2.5">
                      <CheckCircle size={14} className="text-green-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-700 truncate">{m.app.description}</p>
                        <p className="text-xs text-gray-400">{m.app.date}</p>
                      </div>
                      <p className="text-xs font-bold shrink-0 tabular-nums text-green-600">
                        {fmtARS(m.app.amount_ars)}
                      </p>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {importMsg && (
              <p className={`text-sm px-3 py-2 rounded-xl ${importMsg.startsWith('✅') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                {importMsg}
              </p>
            )}
          </div>
        )}

        {/* ── PASO 3: DONE ── */}
        {step === 'done' && (
          <div className="p-8 flex flex-col items-center gap-4 text-center mt-8">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center">
              <CheckCircle size={40} className="text-green-500" />
            </div>
            <h2 className="text-xl font-bold text-gray-800">¡Cuenta conciliada!</h2>
            <p className="text-sm text-gray-500 max-w-xs">
              Los movimientos del banco están ahora reflejados en la app.
            </p>
            {importMsg && (
              <p className="text-sm text-green-600 font-medium">{importMsg}</p>
            )}
            <button onClick={onClose}
              className="mt-4 w-full max-w-xs py-3 bg-brand-600 text-white rounded-xl font-semibold">
              Cerrar
            </button>
          </div>
        )}
      </div>

      {/* Footer fijo — botón importar */}
      {step === 'resultado' && soloEnBanco.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 p-4" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}>
          {seleccionados.size > 0 ? (
            <button onClick={importarFaltantes} disabled={importando}
              className="w-full py-3.5 bg-brand-600 text-white rounded-xl font-semibold text-sm disabled:opacity-50">
              {importando ? 'Importando...' : `Agregar ${seleccionados.size} movimientos — ${fmtARS(totalFaltante)}`}
            </button>
          ) : (
            <p className="text-center text-sm text-gray-400 py-2">Seleccioná los movimientos a importar</p>
          )}
        </div>
      )}
    </div>
  )
}
