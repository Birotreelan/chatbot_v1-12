import { type NextRequest, NextResponse } from "next/server"
import { getClinicInfoImportJob } from "@/lib/db"
import { logger } from "@/lib/logger"

interface RouteParams {
  params: {
    jobId: string
  }
}

// Polling de estado del job de importación (pending → scraping → extracting
// → done/error). El dashboard consulta esto cada 2s mientras el job no esté
// terminado.
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const job = await getClinicInfoImportJob(params.jobId)

    if (!job) {
      return NextResponse.json({ success: false, error: "Job no encontrado" }, { status: 404 })
    }

    return NextResponse.json({ success: true, job })
  } catch (error) {
    logger.error("API", "Error al consultar job de importación", error)
    return NextResponse.json({ success: false, error: "Error interno del servidor" }, { status: 500 })
  }
}
