export interface ObraSocial {
  id: string
  nombre: string
  razon_social: string
  permite_turnos_online: boolean
  permite_turnos_online_texto: string
}

export interface ObrasSocialesResponse {
  obras_sociales: ObraSocial[]
  total_encontradas: number
  busqueda_realizada: string
}

export interface SedeData {
  Id: string
  Nombre_Completo: string
  Domicilio: string
  Telefono: string
  E_Mail: string
  Localidad: string
  Provincia: string
  Horario: string
  Dominio_Web: string
}

export interface SedeResponse {
  success: boolean
  sede: SedeData
}

export interface ApiConfig {
  baseUrl: string
  timeout: number
}

// Función para obtener la configuración de la API de la clínica
export function getClinicApiConfig(): ApiConfig {
  return {
    baseUrl: process.env.CLINIC_PROXY_URL || process.env.PROXY_API_URL || "",
    timeout: 30000,
  }
}
