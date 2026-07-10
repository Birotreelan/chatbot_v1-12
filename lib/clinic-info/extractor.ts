/**
 * Extracción estructurada de información institucional a partir de texto
 * scrapeado (10/7/2026).
 *
 * Importante (ver asesoría previa): esto NO reemplaza la revisión humana.
 * El resultado siempre vuelve como "draft" — lo guarda el admin del cliente
 * desde el dashboard después de revisarlo/editarlo, nunca se persiste solo.
 *
 * La instrucción central del prompt es "no inventar": si un campo no está
 * explícitamente en el texto, va vacío/omitido, nunca inferido o completado
 * con conocimiento general del modelo.
 */

import { openai } from "@/lib/openai"
import type { ClinicInfo } from "@/lib/types"

const EXTRACTION_SYSTEM_PROMPT = `Sos un asistente que extrae información institucional de una clínica oftalmológica a partir del texto de su sitio web.

REGLA MÁS IMPORTANTE: NUNCA inventes ni infieras datos que no estén explícitamente en el texto. Si un dato no aparece, dejá el campo vacío (string vacío, array vacío, o el campo ausente). No completes con conocimiento general sobre clínicas oftalmológicas ni "supongas" nada.

Devolvé un JSON con exactamente esta forma (todos los campos son opcionales, omití o dejá vacío lo que no encuentres):
{
  "telefonoContacto": string,
  "emailContacto": string,
  "horarioAtencion": string,
  "sedes": [{ "nombre": string, "direccion": string, "comoLlegar": string, "horario": string }],
  "especialidades": string[],
  "profesionales": [{ "nombre": string, "especialidad": string }],
  "equipamiento": string[],
  "obrasSociales": string[],
  "instruccionesPreConsulta": string,
  "cuidadosPostOperatorios": string,
  "informacionAdicional": string
}

Notas de formato:
- "especialidades": subespecialidades oftalmológicas mencionadas (ej: catarata, glaucoma, retina, córnea, cirugía refractiva, oculoplástica, estrabismo, baja visión).
- "equipamiento": tecnología/equipos médicos mencionados (ej: OCT, campo visual computarizado, topógrafo corneal, facoemulsificador).
- "obrasSociales": nombres de obras sociales/prepagas mencionadas como aceptadas.
- "informacionAdicional": cualquier dato institucional relevante que no encaje en los campos anteriores (texto libre, breve).
- Si el texto no tiene NADA de información institucional útil (ej: es una página de error, un blog no relacionado), devolvé todos los campos vacíos.`

interface ExtractedFields {
  telefonoContacto?: string
  emailContacto?: string
  horarioAtencion?: string
  sedes?: { nombre?: string; direccion?: string; comoLlegar?: string; horario?: string }[]
  especialidades?: string[]
  profesionales?: { nombre: string; especialidad?: string }[]
  equipamiento?: string[]
  obrasSociales?: string[]
  instruccionesPreConsulta?: string
  cuidadosPostOperatorios?: string
  informacionAdicional?: string
}

function cleanArray(arr: unknown): string[] | undefined {
  if (!Array.isArray(arr)) return undefined
  const cleaned = arr.map((v) => String(v).trim()).filter(Boolean)
  return cleaned.length > 0 ? cleaned : undefined
}

/**
 * Llama al modelo para estructurar el texto scrapeado. Devuelve un
 * `Partial<ClinicInfo>` (sin `clienteId`/`updatedAt` — eso lo completa quien
 * llama, ya que este módulo no conoce el cliente ni la fecha de guardado).
 */
export async function extractClinicInfoFromText(text: string): Promise<Partial<ClinicInfo>> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      { role: "user", content: `Texto del sitio web:\n\n${text}` },
    ],
  })

  const raw = response.choices[0]?.message?.content
  if (!raw) {
    throw new Error("El modelo no devolvió contenido")
  }

  let parsed: ExtractedFields
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error("El modelo devolvió un JSON inválido")
  }

  const sedes = Array.isArray(parsed.sedes)
    ? parsed.sedes
        .map((s) => ({
          nombre: s?.nombre?.trim() || undefined,
          direccion: s?.direccion?.trim() || undefined,
          comoLlegar: s?.comoLlegar?.trim() || undefined,
          horario: s?.horario?.trim() || undefined,
        }))
        .filter((s) => s.nombre || s.direccion || s.comoLlegar || s.horario)
    : undefined

  const profesionales = Array.isArray(parsed.profesionales)
    ? parsed.profesionales
        .map((p) => ({ nombre: p?.nombre?.trim() || "", especialidad: p?.especialidad?.trim() || undefined }))
        .filter((p) => p.nombre)
    : undefined

  const draft: Partial<ClinicInfo> = {
    telefonoContacto: parsed.telefonoContacto?.trim() || undefined,
    emailContacto: parsed.emailContacto?.trim() || undefined,
    horarioAtencion: parsed.horarioAtencion?.trim() || undefined,
    sedes: sedes && sedes.length > 0 ? sedes : undefined,
    especialidades: cleanArray(parsed.especialidades),
    profesionales: profesionales && profesionales.length > 0 ? profesionales : undefined,
    equipamiento: cleanArray(parsed.equipamiento),
    obrasSociales: cleanArray(parsed.obrasSociales),
    instruccionesPreConsulta: parsed.instruccionesPreConsulta?.trim() || undefined,
    cuidadosPostOperatorios: parsed.cuidadosPostOperatorios?.trim() || undefined,
    informacionAdicional: parsed.informacionAdicional?.trim() || undefined,
  }

  return draft
}
