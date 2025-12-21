import { Redis } from "@upstash/redis"
import type { SupportUser } from "./types"
import { nanoid } from "nanoid"
import bcrypt from "bcryptjs"

// Prefijos para las claves en Redis
const SUPPORT_USER_PREFIX = "support_user:"
const SUPPORT_USER_USERNAME_INDEX = "support_user:username:"
const SUPPORT_USERS_ALL = "support_users:all"
const SUPPORT_USERS_BY_TENANT = "support_users:tenant:"

// Función para obtener el cliente de Redis
function getRedisClient() {
  try {
    return Redis.fromEnv()
  } catch (error) {
    console.warn("[Support Users] Upstash Redis no está disponible:", error)
    return null
  }
}

// Crear un nuevo usuario de soporte
export async function createSupportUser(data: {
  username: string
  password: string
  tenantId: string | null
  displayName: string
  email?: string
  role?: "support_agent" | "super_admin"
}): Promise<SupportUser> {
  const redis = getRedisClient()
  if (!redis) {
    throw new Error("Redis no está disponible")
  }

  // Verificar que el username no exista
  const existingUserId = await redis.get(`${SUPPORT_USER_USERNAME_INDEX}${data.username}`)
  if (existingUserId) {
    throw new Error("El nombre de usuario ya existe")
  }

  const id = nanoid()
  const passwordHash = await bcrypt.hash(data.password, 10)
  const now = new Date().toISOString()

  const user: SupportUser = {
    id,
    username: data.username,
    passwordHash,
    role: data.role || "support_agent",
    tenantId: data.tenantId,
    displayName: data.displayName,
    email: data.email,
    active: true,
    createdAt: now,
  }

  // Guardar el usuario
  await redis.set(`${SUPPORT_USER_PREFIX}${id}`, JSON.stringify(user))

  // Crear índice por username
  await redis.set(`${SUPPORT_USER_USERNAME_INDEX}${data.username}`, id)

  // Agregar a la lista de todos los usuarios
  await redis.sadd(SUPPORT_USERS_ALL, id)

  // Si tiene tenant, agregar a la lista de usuarios de ese tenant
  if (data.tenantId) {
    await redis.sadd(`${SUPPORT_USERS_BY_TENANT}${data.tenantId}`, id)
  }

  console.log(`[Support Users] Usuario creado: ${user.username} (${user.role})`)
  return user
}

// Obtener un usuario por ID
export async function getSupportUser(userId: string): Promise<SupportUser | null> {
  const redis = getRedisClient()
  if (!redis) return null

  const userData = await redis.get(`${SUPPORT_USER_PREFIX}${userId}`)
  if (!userData) return null

  if (typeof userData === "string") {
    return JSON.parse(userData)
  }
  return userData as SupportUser
}

// Obtener un usuario por username
export async function getSupportUserByUsername(username: string): Promise<SupportUser | null> {
  const redis = getRedisClient()
  if (!redis) return null

  const userId = await redis.get<string>(`${SUPPORT_USER_USERNAME_INDEX}${username}`)
  if (!userId) return null

  return getSupportUser(userId)
}

// Obtener todos los usuarios de soporte
export async function getAllSupportUsers(): Promise<SupportUser[]> {
  const redis = getRedisClient()
  if (!redis) return []

  const userIds = await redis.smembers(SUPPORT_USERS_ALL)
  if (!userIds || userIds.length === 0) return []

  const users = await Promise.all(userIds.map((id) => getSupportUser(id as string)))
  return users.filter(Boolean) as SupportUser[]
}

// Obtener usuarios por tenant
export async function getSupportUsersByTenant(tenantId: string): Promise<SupportUser[]> {
  const redis = getRedisClient()
  if (!redis) return []

  const userIds = await redis.smembers(`${SUPPORT_USERS_BY_TENANT}${tenantId}`)
  if (!userIds || userIds.length === 0) return []

  const users = await Promise.all(userIds.map((id) => getSupportUser(id as string)))
  return users.filter(Boolean) as SupportUser[]
}

// Actualizar un usuario
export async function updateSupportUser(
  userId: string,
  updates: Partial<Omit<SupportUser, "id" | "createdAt" | "passwordHash">>,
): Promise<SupportUser | null> {
  const redis = getRedisClient()
  if (!redis) return null

  const user = await getSupportUser(userId)
  if (!user) return null

  const updatedUser: SupportUser = {
    ...user,
    ...updates,
    updatedAt: new Date().toISOString(),
  }

  await redis.set(`${SUPPORT_USER_PREFIX}${userId}`, JSON.stringify(updatedUser))

  // Si cambió el tenant, actualizar los sets
  if (updates.tenantId !== undefined && updates.tenantId !== user.tenantId) {
    // Remover del tenant anterior
    if (user.tenantId) {
      await redis.srem(`${SUPPORT_USERS_BY_TENANT}${user.tenantId}`, userId)
    }
    // Agregar al nuevo tenant
    if (updates.tenantId) {
      await redis.sadd(`${SUPPORT_USERS_BY_TENANT}${updates.tenantId}`, userId)
    }
  }

  return updatedUser
}

// Cambiar contraseña
export async function changeSupportUserPassword(userId: string, newPassword: string): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false

  const user = await getSupportUser(userId)
  if (!user) return false

  const passwordHash = await bcrypt.hash(newPassword, 10)

  const updatedUser: SupportUser = {
    ...user,
    passwordHash,
    updatedAt: new Date().toISOString(),
  }

  await redis.set(`${SUPPORT_USER_PREFIX}${userId}`, JSON.stringify(updatedUser))
  return true
}

// Eliminar un usuario
export async function deleteSupportUser(userId: string): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false

  const user = await getSupportUser(userId)
  if (!user) return false

  // Eliminar índices
  await redis.del(`${SUPPORT_USER_USERNAME_INDEX}${user.username}`)
  await redis.srem(SUPPORT_USERS_ALL, userId)

  if (user.tenantId) {
    await redis.srem(`${SUPPORT_USERS_BY_TENANT}${user.tenantId}`, userId)
  }

  // Eliminar el usuario
  await redis.del(`${SUPPORT_USER_PREFIX}${userId}`)

  return true
}

// Verificar contraseña
export async function verifySupportUserPassword(username: string, password: string): Promise<SupportUser | null> {
  const user = await getSupportUserByUsername(username)
  if (!user || !user.active) return null

  const isValid = await bcrypt.compare(password, user.passwordHash)
  if (!isValid) return null

  return user
}
