import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { fmtARS } from '../lib/formato'

const COLORES = [
  '#f43f5e', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#8b5cf6', '#ec4899', '#64748b',
]

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-white shadow-lg rounded-xl px-3 py-2 text-sm border border-gray-100">
      <p className="font-semibold text-gray-800">{d.icon} {d.name}</p>
      <p className="text-gray-600">{fmtARS(d.value)}</p>
      <p className="text-gray-400 text-xs">{d.pct}%</p>
    </div>
  )
}

export default function GraficoCategoria({ movs }) {
  const egresos = movs.filter((m) => m.type === 'expense')
  const total = egresos.reduce((s, m) => s + Number(m.amount_ars), 0)

  const porCat = {}
  egresos.forEach((m) => {
    const key = m.category_id || 'sin-cat'
    if (!porCat[key]) {
      porCat[key] = {
        name: m.categories?.name || 'Sin categoría',
        icon: m.categories?.icon || '📦',
        value: 0,
      }
    }
    porCat[key].value += Number(m.amount_ars)
  })

  const data = Object.values(porCat)
    .sort((a, b) => b.value - a.value)
    .map((d) => ({ ...d, pct: total ? Math.round((d.value / total) * 100) : 0 }))

  if (!data.length) return null

  return (
    <div className="bg-white rounded-2xl shadow-card p-4 mb-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Egresos por categoría</h3>

      {/* Torta centrada */}
      <div className="flex justify-center mb-4">
        <div style={{ width: 180, height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={82}
                paddingAngle={2}
                dataKey="value"
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={COLORES[i % COLORES.length]} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Leyenda full-width — nombres completos */}
      <div className="space-y-2">
        {data.slice(0, 7).map((d, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: COLORES[i % COLORES.length] }}
            />
            <span className="text-sm text-gray-700 flex-1 truncate">
              {d.icon} {d.name}
            </span>
            <span className="text-xs text-gray-400 shrink-0 w-8 text-right">{d.pct}%</span>
            <span className="text-sm font-semibold text-gray-800 shrink-0 w-24 text-right tabular-nums">
              {fmtARS(d.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
