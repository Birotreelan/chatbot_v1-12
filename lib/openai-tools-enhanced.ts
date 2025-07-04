import { getVariedMessage } from "./message-variations"

// Herramientas mejoradas con mensajes variados para OpenAI Assistant

export const ENHANCED_OPENAI_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "validate_dni",
      description: `Valida un DNI y obtiene información del paciente. 
      IMPORTANTE: Antes de ejecutar esta función, SIEMPRE responde al usuario con un mensaje de espera variado usando la categoría 'validating_dni'.
      Ejemplos de mensajes: "Verificando tu DNI, dame un momento por favor." o "Consultando tu información en el sistema, aguardá..."`,
      parameters: {
        type: "object",
        properties: {
          dni: {
            type: "string",
            description: "DNI a validar (solo números, 7-8 dígitos)",
          },
        },
        required: ["dni"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "obtener_subespecialidades",
      description: `Lista las subespecialidades médicas disponibles.
      IMPORTANTE: Antes de ejecutar, responde con un mensaje variado de la categoría 'searching_specialties'.
      Ejemplos: "Verificando qué especialidades tenemos disponibles..." o "Consultando nuestro catálogo de especialidades médicas."`,
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "buscar_profesionales",
      description: `Busca profesionales por nombre o especialidad.
      IMPORTANTE: Antes de ejecutar, responde con un mensaje variado de la categoría 'searching_doctors'.
      Ejemplos: "Buscando profesionales disponibles, aguardá un momento." o "Consultando nuestro equipo médico disponible..."`,
      parameters: {
        type: "object",
        properties: {
          busqueda: {
            type: "string",
            description: "Texto para buscar profesionales por nombre o especialidad",
          },
        },
        required: ["busqueda"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_turnos",
      description: `Busca turnos disponibles. Si no se especifica rangoFechas, usa fechas actuales automáticamente.
      IMPORTANTE: Antes de ejecutar, responde con un mensaje variado de la categoría 'searching_appointments'.
      Ejemplos: "Consultando la agenda para encontrar turnos libres..." o "Buscando turnos disponibles en las fechas solicitadas."`,
      parameters: {
        type: "object",
        properties: {
          rangoFechas: {
            type: "string",
            description:
              "Rango de fechas en formato YYYY-MM-DD a YYYY-MM-DD. Si no se especifica, usa fechas actuales.",
          },
          profesional: {
            type: "string",
            description: "Nombre del profesional (opcional)",
          },
          especialidad: {
            type: "string",
            description: "Nombre de la especialidad (opcional)",
          },
          profesionalId: {
            type: "string",
            description: "ID del profesional (opcional)",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "reserve_turno",
      description: `Reserva un turno específico para un paciente usando los datos recopilados durante la conversación.
      IMPORTANTE: Antes de ejecutar, responde con un mensaje variado de la categoría 'processing_reservation'.
      Ejemplos: "Procesando tu reserva de turno, aguardá un momento." o "Confirmando tu turno en el sistema, esto tomará unos segundos."`,
      parameters: {
        type: "object",
        properties: {
          dni: {
            type: "string",
            description: "DNI del paciente",
          },
          nombre: {
            type: "string",
            description: "Nombre del paciente recopilado durante la conversación",
          },
          apellido: {
            type: "string",
            description: "Apellido del paciente recopilado durante la conversación",
          },
          telefono: {
            type: "string",
            description: "Teléfono del paciente recopilado durante la conversación",
          },
          email: {
            type: "string",
            description: "Email del paciente recopilado durante la conversación",
          },
          fecha: {
            type: "string",
            description: "Fecha del turno en formato YYYY-MM-DD",
          },
          hora: {
            type: "string",
            description: "Hora del turno en formato HH:MM",
          },
          profesional: {
            type: "string",
            description: "Nombre del profesional",
          },
          agendaId: {
            type: "string",
            description: "ID del turno/agenda a reservar",
          },
        },
        required: ["dni", "nombre", "apellido", "telefono", "email", "fecha", "hora", "profesional", "agendaId"],
      },
    },
  },
]

// Función helper para generar mensajes de espera contextuales
export function generateWaitingMessage(action: string, context?: string): string {
  switch (action) {
    case "validate_dni":
      return getVariedMessage("validating_dni", context)
    case "search_specialties":
      return getVariedMessage("searching_specialties", context)
    case "search_appointments":
      return getVariedMessage("searching_appointments", context)
    case "search_doctors":
      return getVariedMessage("searching_doctors", context)
    case "process_reservation":
      return getVariedMessage("processing_reservation", context)
    default:
      return getVariedMessage("general_processing", context)
  }
}
