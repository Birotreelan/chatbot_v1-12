import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/auth"
import { getSupportUsersByTenant } from "@/lib/support-users"

export async function GET(request: Request, { params }: { params: { tenantId: string } }) {
  try {
    await requireSuperAdmin()

    const users = await getSupportUsersByTenant(params.tenantId)

    // No devolver hashes de contraseña
    const usersWithoutPasswords = users.map(({ passwordHash, ...user }) => user)

    return NextResponse.json(usersWithoutPasswords)
  } catch (error) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }
}
