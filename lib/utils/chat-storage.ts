// Utilidades para persistencia de conversaciones en localStorage

interface StoredMessage {
  id: string
  content: string
  isUser: boolean
  timestamp: number
}

interface ChatSession {
  sessionId: string
  threadId?: string
  messages: StoredMessage[]
  createdAt: number
  lastAccessAt: number
  clienteId: string
  config?: {
    displayName?: string
    widgetTitle?: string
  }
}

const STORAGE_KEY = "treelan_chat_session"
const MAX_MESSAGES = 50 // Límite de mensajes guardados
const MAX_AGE_DAYS = 30 // Días antes de limpiar automáticamente

/**
 * Guardar sesión de chat en localStorage
 */
export function saveChatSession(session: ChatSession): void {
  try {
    // Limitar número de mensajes
    if (session.messages.length > MAX_MESSAGES) {
      session.messages = session.messages.slice(-MAX_MESSAGES)
    }

    // Actualizar timestamp de último acceso
    session.lastAccessAt = Date.now()

    localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
    console.log("[CHAT-STORAGE] ✅ Sesión guardada:", session.sessionId)
  } catch (error) {
    console.error("[CHAT-STORAGE] ❌ Error guardando sesión:", error)
  }
}

/**
 * Cargar sesión de chat desde localStorage
 */
export function loadChatSession(clienteId: string): ChatSession | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) {
      console.log("[CHAT-STORAGE] ℹ️ No hay sesión guardada")
      return null
    }

    const session: ChatSession = JSON.parse(stored)

    // Verificar que sea para el mismo cliente
    if (session.clienteId !== clienteId) {
      console.log("[CHAT-STORAGE] ⚠️ Sesión de otro cliente, limpiando")
      clearChatSession()
      return null
    }

    // Verificar antigüedad
    const ageInDays = (Date.now() - session.createdAt) / (1000 * 60 * 60 * 24)
    if (ageInDays > MAX_AGE_DAYS) {
      console.log("[CHAT-STORAGE] ⚠️ Sesión muy antigua, limpiando")
      clearChatSession()
      return null
    }

    console.log("[CHAT-STORAGE] ✅ Sesión cargada:", {
      sessionId: session.sessionId,
      messages: session.messages.length,
      age: Math.floor(ageInDays) + " días",
    })

    return session
  } catch (error) {
    console.error("[CHAT-STORAGE] ❌ Error cargando sesión:", error)
    return null
  }
}

/**
 * Agregar mensaje a la sesión actual
 */
export function addMessageToSession(
  clienteId: string,
  sessionId: string,
  content: string,
  isUser: boolean,
  threadId?: string,
): void {
  const session = loadChatSession(clienteId) || createNewSession(clienteId, sessionId, threadId)

  const message: StoredMessage = {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    content,
    isUser,
    timestamp: Date.now(),
  }

  session.messages.push(message)

  // Actualizar threadId si se proporciona
  if (threadId) {
    session.threadId = threadId
  }

  saveChatSession(session)
}

/**
 * Crear nueva sesión
 */
function createNewSession(clienteId: string, sessionId: string, threadId?: string): ChatSession {
  return {
    sessionId,
    threadId,
    messages: [],
    createdAt: Date.now(),
    lastAccessAt: Date.now(),
    clienteId,
  }
}

/**
 * Limpiar sesión actual
 */
export function clearChatSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
    console.log("[CHAT-STORAGE] ✅ Sesión limpiada")
  } catch (error) {
    console.error("[CHAT-STORAGE] ❌ Error limpiando sesión:", error)
  }
}

/**
 * Actualizar threadId de la sesión
 */
export function updateSessionThreadId(clienteId: string, threadId: string): void {
  const session = loadChatSession(clienteId)
  if (session) {
    session.threadId = threadId
    saveChatSession(session)
    console.log("[CHAT-STORAGE] ✅ ThreadId actualizado:", threadId)
  }
}

/**
 * Obtener sessionId guardado (si existe)
 */
export function getSavedSessionId(clienteId: string): string | null {
  const session = loadChatSession(clienteId)
  return session?.sessionId || null
}

/**
 * Obtener threadId guardado (si existe)
 */
export function getSavedThreadId(clienteId: string): string | null {
  const session = loadChatSession(clienteId)
  return session?.threadId || null
}

/**
 * Cargar mensajes guardados
 */
export function loadSavedMessages(clienteId: string): StoredMessage[] {
  const session = loadChatSession(clienteId)
  return session?.messages || []
}
