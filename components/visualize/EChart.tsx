'use client'

import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, BoxplotChart, HeatmapChart, LineChart, PieChart, ScatterChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  TitleComponent,
  ToolboxComponent,
  DataZoomComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  BarChart,
  BoxplotChart,
  HeatmapChart,
  LineChart,
  PieChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  TitleComponent,
  ToolboxComponent,
  DataZoomComponent,
  CanvasRenderer,
])

/**
 * Renders a backend-provided Apache ECharts option verbatim. The frontend
 * never infers chart logic — the VIE spec is complete (axes, series,
 * tooltips, legends, mark lines). Resizes with its container and re-applies
 * the option when it changes.
 */
export function EChart({ option, height = 320 }: { option: Record<string, unknown>; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const chart = echarts.init(el)
    chartRef.current = chart
    chart.setOption(option as echarts.EChartsCoreOption, true)
    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(el)
    return () => {
      ro.disconnect()
      chart.dispose()
      chartRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    chartRef.current?.setOption(option as echarts.EChartsCoreOption, true)
  }, [option])

  return <div ref={containerRef} style={{ height, width: '100%' }} />
}
