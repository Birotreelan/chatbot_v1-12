// Tipos para las respuestas de API
export interface Paciente {
  id: string
  nombre: string
  apellido: string
  dni: string
  email?: string
  telefono?: string
  ultima_visita?: string
  proxima_cita?: string
  estado: "activo" | "inactivo"
  es_nuevo?: boolean // Añadimos este campo para indicar si es un paciente nuevo
}

export interface Cita {
  id: string
  paciente_id: string
  paciente_nombre: string
  fecha: string
  hora: string
  doctor_id: string
  doctor_nombre: string
  estado: "programada" | "completada" | "cancelada"
  notas?: string
}

export interface DisponibilidadHoraria {
  fecha: string
  horas_disponibles: string[]
  doctor_id: string
  doctor_nombre: string
}

export interface HistorialMedico {
  id: string
  paciente_id: string
  fecha: string
  diagnostico: string
  tratamiento: string
  notas?: string
}

// Tipos para los errores
export interface ApiError {
  codigo: string
  mensaje: string
}

// Tipos para las respuestas
export type ApiResponse<T> = { exito: true; datos: T } | { exito: false; error: ApiError }
