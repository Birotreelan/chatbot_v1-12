"use client"

import type React from "react"

import { Bot, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"

interface WhatsAppCtaPreviewProps {
  clinicName: string
  whatsappNumber?: string
}

// Mensaje predefinido que llega ya escrito en WhatsApp al tocar el botón.
// Dirigido a Iris en primera persona, como lo escribiría un paciente real.
const PRESET_MESSAGE = "¡Hola Iris! 👋 Quiero agendar un turno."

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885M20.52 3.449C18.24 1.245 15.24 0 12.045 0 5.463 0 .104 5.359.101 11.892c0 2.096.549 4.142 1.595 5.945L0 24l6.335-1.652a11.899 11.899 0 005.71 1.454h.005c6.582 0 11.943-5.359 11.945-11.892a11.821 11.821 0 00-3.495-8.411" />
    </svg>
  )
}

function buildWhatsAppUrl(digits: string, message: string) {
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
}

export function WhatsAppCtaPreview({ clinicName, whatsappNumber }: WhatsAppCtaPreviewProps) {
  const { toast } = useToast()
  const digits = (whatsappNumber || "").replace(/\D/g, "")
  const hasNumber = digits.length >= 8
  const waUrl = hasNumber ? buildWhatsAppUrl(digits, PRESET_MESSAGE) : ""

  const copyLink = async () => {
    if (!waUrl || typeof navigator === "undefined" || !navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(waUrl)
      toast({ title: "Copiado", description: "El enlace de WhatsApp se copió al portapapeles." })
    } catch (error) {
      console.error("Error al copiar el enlace de WhatsApp:", error)
    }
  }

  return (
    <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-emerald-50 p-6">
      <div className="flex items-start gap-4">
        <div className="relative shrink-0">
          <div className="h-14 w-14 rounded-full bg-[#25D366] flex items-center justify-center shadow-lg shadow-emerald-200">
            <WhatsAppIcon className="h-7 w-7 text-white" />
          </div>
          {/* Insignia que marca que del otro lado responde un asistente de IA, no una línea humana */}
          <div className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-sky-600 border-2 border-white flex items-center justify-center">
            <Bot className="h-3.5 w-3.5 text-white" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900">¿Preferís WhatsApp?</h3>
          <p className="text-sm text-gray-600 mt-0.5">
            Hablá directo con <span className="font-medium text-gray-800">Iris</span>, la asistente virtual de{" "}
            {clinicName || "la clínica"}, y agendá tu turno en segundos.
          </p>
        </div>
      </div>

      <div className="mt-5">
        {hasNumber ? (
          <>
            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-[#25D366] hover:bg-[#20bd5a] text-white font-medium py-3 px-6 shadow-md shadow-emerald-200 transition-colors"
            >
              <WhatsAppIcon className="h-5 w-5" />
              Escribirle a Iris por WhatsApp
            </a>
            <div className="flex items-center justify-between gap-3 mt-3">
              <p className="text-xs text-gray-500 truncate">
                Mensaje predefinido: <span className="italic">"{PRESET_MESSAGE}"</span>
              </p>
              <Button variant="ghost" size="sm" className="text-xs shrink-0" onClick={copyLink}>
                <Copy className="h-3.5 w-3.5 mr-1" />
                Copiar enlace
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
            Esta clínica no tiene un "Número de WhatsApp" cargado en su configuración — no se puede generar el enlace.
          </p>
        )}
      </div>
    </div>
  )
}
