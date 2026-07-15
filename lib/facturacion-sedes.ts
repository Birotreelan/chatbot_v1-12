// Mapeo de clientes con múltiples sedes que requieren desglosar el total de
// interacciones por sede usando un servicio externo de porcentajes.
//
// El servicio externo devuelve, para un rango de fechas, el porcentaje de
// interacciones que corresponde a cada sede/centro. Con eso repartimos el
// "Total de Interacciones" ya calculado para el cliente.
//
// Si en el futuro hay más clientes con este esquema, alcanza con agregar
// una entrada acá.
export const CLIENTES_CON_SEDES: Record<string, { porcentajesUrlBase: string }> = {
  "faf82cd7-4b56-11ef-b8bf-7824af3b5123": {
    porcentajesUrlBase: "https://saludocular.com.ar/treelan/porcentajes.php",
  },
}

// Clientes de testing/internos que no se facturan y deben omitirse del
// listado de Facturación.
export const CLIENTES_EXCLUIDOS_FACTURACION: string[] = ["ab429655-01c2-11ef-8b43-fa16c0a84c04"]

export interface PorcentajeSede {
  Centro_Nombre: string
  porcentaje: number
}

interface PorcentajesResponse {
  fecha_inicio: string
  fecha_fin: string
  centros: PorcentajeSede[]
}

export async function getPorcentajesPorSede(
  clienteId: string,
  fechaInicio: string,
  fechaFin: string,
): Promise<PorcentajeSede[] | null> {
  const mapping = CLIENTES_CON_SEDES[clienteId]
  if (!mapping) return null

  try {
    const url = `${mapping.porcentajesUrlBase}?fecha_inicio=${fechaInicio}&fecha_fin=${fechaFin}`
    const response = await fetch(url)
    if (!response.ok) {
      console.warn(`[FACTURACION_SEDES] Error ${response.status} consultando porcentajes para ${clienteId}`)
      return null
    }
    const data: PorcentajesResponse = await response.json()
    if (!Array.isArray(data.centros) || data.centros.length === 0) return null
    return data.centros
  } catch (err) {
    console.warn(`[FACTURACION_SEDES] Error consultando porcentajes para ${clienteId}:`, err)
    return null
  }
}

/**
 * Reparte un total de interacciones entre sedes según sus porcentajes,
 * asegurando que la suma de las partes sea exactamente igual al total
 * (el redondeo se ajusta en la última sede).
 */
export function repartirInteraccionesPorSede(
  total: number,
  centros: PorcentajeSede[],
): Array<{ nombre: string; interacciones: number }> {
  const resultado = centros.map((centro) => ({
    nombre: centro.Centro_Nombre,
    interacciones: Math.round((total * centro.porcentaje) / 100),
  }))

  const sumaRedondeada = resultado.reduce((sum, r) => sum + r.interacciones, 0)
  const diferencia = total - sumaRedondeada

  if (diferencia !== 0 && resultado.length > 0) {
    // Ajustar la diferencia de redondeo en la sede con mayor porcentaje
    const indiceMayor = centros.reduce(
      (maxIdx, centro, idx, arr) => (centro.porcentaje > arr[maxIdx].porcentaje ? idx : maxIdx),
      0,
    )
    resultado[indiceMayor].interacciones += diferencia
  }

  return resultado
}
