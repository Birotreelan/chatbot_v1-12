// Cotización del dólar oficial, usada para convertir el "Valor por unidad"
// (definido en USD) a un "Valor total" en pesos dentro de Facturación.
const DOLAR_API_URL = "https://dolarapi.com/v1/dolares/oficial"

interface DolarApiResponse {
  moneda: string
  casa: string
  nombre: string
  compra: number
  venta: number
  fechaActualizacion: string
}

export async function getDolarVenta(): Promise<number | null> {
  try {
    const response = await fetch(DOLAR_API_URL, { cache: "no-store" })
    if (!response.ok) {
      console.warn(`[FACTURACION_DOLAR] Error ${response.status} consultando dolarapi`)
      return null
    }
    const data: DolarApiResponse = await response.json()
    return typeof data.venta === "number" ? data.venta : null
  } catch (err) {
    console.warn("[FACTURACION_DOLAR] Error consultando dolarapi:", err)
    return null
  }
}
