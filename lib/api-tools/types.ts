import { resolveProxyUrl } from "../proxy-url-resolver"

// Interfaz para datos del paciente
export interface Paciente {
  id?: string
  nombre?: string
  apellido?: string
  nombre_completo?: string
  dni?: string
  documento?: string
  telefono?: string
  celular?: string
  email?: string
  mail?: string
  fecha_nacimiento?: string
  direccion?: string
  localidad?: string
  provincia?: string
  obra_social?: string
  plan?: string
  nro_afiliado?: string
  sexo?: string
  [key: string]: any
}

// Interfaz para turnos/citas
export interface Cita {
  id?: string
  fecha?: string
  hora?: string
  profesional?: string
  profesional_id?: string
  especialidad?: string
  lugar?: string
  sede?: string
  estado?: string
  motivo?: string
  [key: string]: any
}

// Interfaz para respuestas de API
export interface ApiResponse<T> {
  exito: boolean
  datos?: T
  error?: {
    codigo: string
    mensaje: string
  }
  turnosProximos?: Cita[]
  esPrimeraVez?: boolean | null
  /**
   * Límite de turnos activos permitidos por paciente (17/7/2026). Ausente o
   * con maximo: null => la clínica no configuró límite, no se aplica ninguna
   * restricción.
   */
  limiteTurnos?: {
    maximo: number | null
    activos: number
    alcanzado: boolean
  } | null
}

// Interfaz para disponibilidad horaria
export interface DisponibilidadHoraria {
  fecha: string
  horarios: string[]
  profesional_id?: string
  sede_id?: string
}

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

// Función para obtener la configuración de la API de la clínica: URL propia
// del cliente (config.proxy) con fallback a las variables de entorno
// globales — ver lib/proxy-url-resolver.ts. Nunca lanza: si nada está
// configurado, baseUrl queda "" (los callers ya manejan ese caso).
export async function getClinicApiConfig(clienteId: string): Promise<ApiConfig> {
  let baseUrl = ""
  try {
    baseUrl = await resolveProxyUrl(clienteId)
  } catch {
    // resolveProxyUrl lanza si no hay URL configurada ni por clínica ni
    // globalmente — acá se traduce a baseUrl vacío, como devolvía antes.
  }
  return {
    baseUrl,
    timeout: 30000,
  }
}
