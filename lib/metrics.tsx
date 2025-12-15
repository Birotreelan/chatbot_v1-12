// Sistema de métricas para monitoreo

interface MetricData {
  count: number
  lastUpdated: string
}

const metrics = new Map<string, MetricData>()

export async function incrementMetric(metricName: string, value = 1): Promise<void> {
  const current = metrics.get(metricName) || { count: 0, lastUpdated: new Date().toISOString() }

  const updated: MetricData = {
    count: current.count + value,
    lastUpdated: new Date().toISOString(),
  }

  metrics.set(metricName, updated)

  console.log(`[METRIC] ${metricName}: ${updated.count}`)
}

export async function getMetric(metricName: string): Promise<number> {
  const metric = metrics.get(metricName)
  return metric ? metric.count : 0
}

export async function getAllMetrics(): Promise<Record<string, number>> {
  const result: Record<string, number> = {}

  for (const [key, value] of metrics.entries()) {
    result[key] = value.count
  }

  return result
}

export async function resetMetric(metricName: string): Promise<void> {
  metrics.delete(metricName)
  console.log(`[METRIC] ${metricName} reset`)
}
