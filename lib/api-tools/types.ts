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
