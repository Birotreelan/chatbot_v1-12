import { getSedes } from "./clinic-api"

async function createSystemBlockWithSedes(
  config: any,
  userPhoneNumber: string,
  isNewThread: boolean,
  isResetThread: boolean,
  messageType: string,
): Promise<string> {
  const fechaHora = getArgentinaDateTime()

  let sedesInfo = "No disponible"

  // Obtener datos de sedes si tenemos cliente_id
  if (config.cliente_id) {
    try {
      console.log(`[WHATSAPP] 🏥 Obteniendo datos de sedes para cliente: ${config.cliente_id}`)
      const sedesResult = await getSedes(config.cliente_id)

      if (sedesResult.success && sedesResult.data) {
        // Formatear los datos de sedes para el bloque [SISTEMA]
        if (Array.isArray(sedesResult.data)) {
          sedesInfo = sedesResult.data
            .map(
              (sede: any) =>
                `Nombre: ${sede.Nombre_Completo || sede.nombre || "Sin nombre"}, ` +
                `Domicilio: ${sede.Domicilio || sede.direccion || "Sin dirección"}, ` +
                `Telefono: ${sede.Telefono || sede.telefono || "Sin teléfono"}, ` +
                `Email: ${sede.E_Mail || sede.email || "Sin email"}, ` +
                `Localidad: ${sede.Localidad || sede.localidad || "Sin localidad"}, ` +
                `Provincia: ${sede.Provincia || sede.provincia || "Sin provincia"}, ` +
                `Horario: ${sede.Horario || sede.horario || "Sin horario"}, ` +
                `Web: ${sede.Dominio_Web || sede.web || "Sin web"}`,
            )
            .join(" | ")
        } else if (sedesResult.data.sedes && Array.isArray(sedesResult.data.sedes)) {
          sedesInfo = sedesResult.data.sedes
            .map(
              (sede: any) =>
                `Nombre: ${sede.Nombre_Completo || sede.nombre || "Sin nombre"}, ` +
                `Domicilio: ${sede.Domicilio || sede.direccion || "Sin dirección"}, ` +
                `Telefono: ${sede.Telefono || sede.telefono || "Sin teléfono"}, ` +
                `Email: ${sede.E_Mail || sede.email || "Sin email"}, ` +
                `Localidad: ${sede.Localidad || sede.localidad || "Sin localidad"}, ` +
                `Provincia: ${sede.Provincia || sede.provincia || "Sin provincia"}, ` +
                `Horario: ${sede.Horario || sede.horario || "Sin horario"}, ` +
                `Web: ${sede.Dominio_Web || sede.web || "Sin web"}`,
            )
            .join(" | ")
        } else {
          // Si es un objeto único, formatearlo
          const sede = sedesResult.data
          sedesInfo =
            `Nombre: ${sede.Nombre_Completo || sede.nombre || "Sin nombre"}, ` +
            `Domicilio: ${sede.Domicilio || sede.direccion || "Sin dirección"}, ` +
            `Telefono: ${sede.Telefono || sede.telefono || "Sin teléfono"}, ` +
            `Email: ${sede.E_Mail || sede.email || "Sin email"}, ` +
            `Localidad: ${sede.Localidad || sede.localidad || "Sin localidad"}, ` +
            `Provincia: ${sede.Provincia || sede.provincia || "Sin provincia"}, ` +
            `Horario: ${sede.Horario || sede.horario || "Sin horario"}, ` +
            `Web: ${sede.Dominio_Web || sede.web || "Sin web"}`
        }
        console.log(`[WHATSAPP] ✅ Sedes obtenidas y formateadas`)
      } else {
        console.log(`[WHATSAPP] ⚠️ No se pudieron obtener sedes: ${sedesResult.error}`)
        sedesInfo = `Error: ${sedesResult.error}`
      }
    } catch (error) {
      console.error(`[WHATSAPP] ❌ Error obteniendo sedes:`, error)
      sedesInfo = "Error al obtener sedes"
    }
  }

  return `[SISTEMA]
Nombre: ${config.displayName}
FechaHora: ${fechaHora}
PrimerMensaje: ${isNewThread}
ThreadReseteado: ${isResetThread}
TipoMensaje: ${messageType}
PacienteCelular: ${userPhoneNumber}
Cliente_id: ${config.cliente_id || "No configurado"}
sede_id: ${config.sede_id || "No configurado"}
Sedes_Disponibles: ${sedesInfo}
[/SISTEMA]`
}

async function createSystemBlock(
  config: WhatsAppConfig,
  phoneNumber: string,
  isFirstMessage: boolean,
  isResetThread: boolean,
  messageType: string,
): Promise<string> {
  const fechaHora = getArgentinaDateTime()

  let sedesInfo = "No disponible"

  // Obtener datos de sedes si tenemos cliente_id
  if (config.cliente_id) {
    try {
      console.log(`[WHATSAPP] 🏥 Obteniendo datos de sedes para cliente: ${config.cliente_id}`)
      const sedesResult = await getSedes(config.cliente_id)

      if (sedesResult.success && sedesResult.data) {
        // Formatear los datos de sedes para el bloque [SISTEMA]
        if (Array.isArray(sedesResult.data)) {
          sedesInfo = sedesResult.data
            .map(
              (sede: any) =>
                `Nombre: ${sede.Nombre_Completo || sede.nombre || "Sin nombre"}, ` +
                `Domicilio: ${sede.Domicilio || sede.direccion || "Sin dirección"}, ` +
                `Telefono: ${sede.Telefono || sede.telefono || "Sin teléfono"}, ` +
                `Email: ${sede.E_Mail || sede.email || "Sin email"}, ` +
                `Localidad: ${sede.Localidad || sede.localidad || "Sin localidad"}, ` +
                `Provincia: ${sede.Provincia || sede.provincia || "Sin provincia"}, ` +
                `Horario: ${sede.Horario || sede.horario || "Sin horario"}, ` +
                `Web: ${sede.Dominio_Web || sede.web || "Sin web"}`,
            )
            .join(" | ")
        } else if (sedesResult.data.sedes && Array.isArray(sedesResult.data.sedes)) {
          sedesInfo = sedesResult.data.sedes
            .map(
              (sede: any) =>
                `Nombre: ${sede.Nombre_Completo || sede.nombre || "Sin nombre"}, ` +
                `Domicilio: ${sede.Domicilio || sede.direccion || "Sin dirección"}, ` +
                `Telefono: ${sede.Telefono || sede.telefono || "Sin teléfono"}, ` +
                `Email: ${sede.E_Mail || sede.email || "Sin email"}, ` +
                `Localidad: ${sede.Localidad || sede.localidad || "Sin localidad"}, ` +
                `Provincia: ${sede.Provincia || sede.provincia || "Sin provincia"}, ` +
                `Horario: ${sede.Horario || sede.horario || "Sin horario"}, ` +
                `Web: ${sede.Dominio_Web || sede.web || "Sin web"}`,
            )
            .join(" | ")
        } else {
          // Si es un objeto único, formatearlo
          const sede = sedesResult.data
          sedesInfo =
            `Nombre: ${sede.Nombre_Completo || sede.nombre || "Sin nombre"}, ` +
            `Domicilio: ${sede.Domicilio || sede.direccion || "Sin dirección"}, ` +
            `Telefono: ${sede.Telefono || sede.telefono || "Sin teléfono"}, ` +
            `Email: ${sede.E_Mail || sede.email || "Sin email"}, ` +
            `Localidad: ${sede.Localidad || sede.localidad || "Sin localidad"}, ` +
            `Provincia: ${sede.Provincia || sede.provincia || "Sin provincia"}, ` +
            `Horario: ${sede.Horario || sede.horario || "Sin horario"}, ` +
            `Web: ${sede.Dominio_Web || sede.web || "Sin web"}`
        }
        console.log(`[WHATSAPP] ✅ Sedes obtenidas y formateadas`)
      } else {
        console.log(`[WHATSAPP] ⚠️ No se pudieron obtener sedes: ${sedesResult.error}`)
        sedesInfo = `Error: ${sedesResult.error}`
      }
    } catch (error) {
      console.error(`[WHATSAPP] ❌ Error obteniendo sedes:`, error)
      sedesInfo = "Error al obtener sedes"
    }
  }

  return `[SISTEMA]
Nombre: ${config.displayName}
FechaHora: ${fechaHora}
PrimerMensaje: ${isFirstMessage}
ThreadReseteado: ${isResetThread}
TipoMensaje: ${messageType}
PacienteCelular: ${phoneNumber}
Cliente_id: ${config.cliente_id || "No configurado"}
sede_id: ${config.sede_id || "No configurado"}
Sedes_Disponibles: ${sedesInfo}
[/SISTEMA]`
}

async function processIndividualMessage(
  phoneNumber: string,
  userMessage: string,
  messageType: string,
  config: WhatsAppConfig,
): Promise<void> {
  // Assuming the rest of the code here is already implemented
  const threadResult = { isNewThread: true, isResetThread: false } // Example condition
  const userPhoneNumber = phoneNumber
  // Preparar mensaje con parámetros iniciales
  const fechaHora = getArgentinaDateTime()

  // Obtener información de sedes
  let sedesInfo = "No disponible"
  if (config.cliente_id) {
    try {
      console.log(`[WHATSAPP] 🏥 Obteniendo datos de sedes para cliente: ${config.cliente_id}`)
      const sedesResult = await getSedes(config.cliente_id)

      if (sedesResult.success && sedesResult.data) {
        if (Array.isArray(sedesResult.data)) {
          sedesInfo = sedesResult.data
            .map(
              (sede: any) =>
                `Nombre: ${sede.Nombre_Completo || sede.nombre || "Sin nombre"}, ` +
                `Domicilio: ${sede.Domicilio || sede.direccion || "Sin dirección"}, ` +
                `Telefono: ${sede.Telefono || sede.telefono || "Sin teléfono"}, ` +
                `Email: ${sede.E_Mail || sede.email || "Sin email"}, ` +
                `Localidad: ${sede.Localidad || sede.localidad || "Sin localidad"}, ` +
                `Provincia: ${sede.Provincia || sede.provincia || "Sin provincia"}, ` +
                `Horario: ${sede.Horario || sede.horario || "Sin horario"}, ` +
                `Web: ${sede.Dominio_Web || sede.web || "Sin web"}`,
            )
            .join(" | ")
        } else if (sedesResult.data.sedes && Array.isArray(sedesResult.data.sedes)) {
          sedesInfo = sedesResult.data.sedes
            .map(
              (sede: any) =>
                `Nombre: ${sede.Nombre_Completo || sede.nombre || "Sin nombre"}, ` +
                `Domicilio: ${sede.Domicilio || sede.direccion || "Sin dirección"}, ` +
                `Telefono: ${sede.Telefono || sede.telefono || "Sin teléfono"}, ` +
                `Email: ${sede.E_Mail || sede.email || "Sin email"}, ` +
                `Localidad: ${sede.Localidad || sede.localidad || "Sin localidad"}, ` +
                `Provincia: ${sede.Provincia || sede.provincia || "Sin provincia"}, ` +
                `Horario: ${sede.Horario || sede.horario || "Sin horario"}, ` +
                `Web: ${sede.Dominio_Web || sede.web || "Sin web"}`,
            )
            .join(" | ")
        } else {
          const sede = sedesResult.data
          sedesInfo =
            `Nombre: ${sede.Nombre_Completo || sede.nombre || "Sin nombre"}, ` +
            `Domicilio: ${sede.Domicilio || sede.direccion || "Sin dirección"}, ` +
            `Telefono: ${sede.Telefono || sede.telefono || "Sin teléfono"}, ` +
            `Email: ${sede.E_Mail || sede.email || "Sin email"}, ` +
            `Localidad: ${sede.Localidad || sede.localidad || "Sin localidad"}, ` +
            `Provincia: ${sede.Provincia || sede.provincia || "Sin provincia"}, ` +
            `Horario: ${sede.Horario || sede.horario || "Sin horario"}, ` +
            `Web: ${sede.Dominio_Web || sede.web || "Sin web"}`
        }
        console.log(`[WHATSAPP] ✅ Sedes obtenidas y formateadas`)
      } else {
        console.log(`[WHATSAPP] ⚠️ No se pudieron obtener sedes: ${sedesResult.error}`)
        sedesInfo = `Error: ${sedesResult.error}`
      }
    } catch (error) {
      console.error(`[WHATSAPP] ❌ Error obteniendo sedes:`, error)
      sedesInfo = "Error al obtener sedes"
    }
  }

  let messageToSend = `[SISTEMA]
Nombre: ${config.displayName}
FechaHora: ${fechaHora}
PrimerMensaje: ${threadResult.isNewThread}
TipoMensaje: ${messageType}
PacienteCelular: ${userPhoneNumber}
Cliente_id: ${config.cliente_id}
sede_id: ${config.sede_id}
Sedes_Disponibles: ${sedesInfo}
[/SISTEMA]

${userMessage}`

  // Si es un thread reseteado, indicarlo
  if (threadResult.isResetThread) {
    messageToSend = `[SISTEMA]
Nombre: ${config.displayName}
FechaHora: ${fechaHora}
PrimerMensaje: true
ThreadReseteado: true
TipoMensaje: ${messageType}
PacienteCelular: ${userPhoneNumber}
Cliente_id: ${config.cliente_id}
sede_id: ${config.sede_id}
Sedes_Disponibles: ${sedesInfo}
[/SISTEMA]

${userMessage}`
  }
  console.log(messageToSend)
}

async function processUserQueue(queue: MessageQueue): Promise<void> {
  for (const messageData of queue) {
    const phoneNumber = messageData.phoneNumber
    await processIndividualMessage(phoneNumber, messageData.userMessage, messageData.messageType, messageData.config)
  }
}

function getArgentinaDateTime(): string {
  const now = new Date()
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/Buenos_Aires",
  }
  return now.toLocaleString("es-AR", options)
}

interface WhatsAppConfig {
  displayName: string
  cliente_id?: string
  sede_id?: string
}

interface MessageQueue {
  phoneNumber: string
  userMessage: string
  messageType: string
  config: WhatsAppConfig
}
