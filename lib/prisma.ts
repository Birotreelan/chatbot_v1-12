// Este archivo es para compatibilidad con referencias existentes
// En este proyecto usamos Redis/Upstash en lugar de Prisma

// Crear un objeto mock para compatibilidad
const prisma = {
  // Mock object para evitar errores de referencia
  $connect: async () => {},
  $disconnect: async () => {},
}

export { prisma }
export default prisma
