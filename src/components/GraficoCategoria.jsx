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
    <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Egresos por categoría</h3>
      <div className="flex gap-4 items-center">
        {/* Torta */}
        <div className="w-28 h-28 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={28}
                outerRadius={52}
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

        {/* Leyenda */}
        <div className="flex-1 space-y-1.5 overflow-hidden">
          {data.slice(0, 6).map((d, i) => (
            <div key={i} className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: COLORES[i % COLORES.length] }}
              />
              <span className="text-xs text-gray-600 truncate flex-1">{d.icon} {d.name}</span>
              <div className="text-right shrink-0">
                <p className="text-xs font-semibold text-gray-800">{fmtARS(d.value)}</p>
                <p className="text-xs text-gray-400">{d.pct}%</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
