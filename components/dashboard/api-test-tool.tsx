"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import type { WhatsAppConfig } from "@/lib/types"

interface ApiTestToolProps {
  config: WhatsAppConfig
}

export function ApiTestTool({ config }: ApiTestToolProps) {
  const { toast } = useToast()
  const [testType, setTestType] = useState<string>("buscarPaciente")
  const [dni, setDni] = useState<string>("")
  const [telefono, setTelefono] = useState<string>("")
  const [fecha, setFecha] = useState<string>("")
  const [fechaDesde, setFechaDesde] = useState<string>("")
  const [fechaHasta, setFechaHasta] = useState<string>("")
  const [doctorId, setDoctorId] = useState<string>("")
  const [busqueda, setBusqueda] = useState<string>("")
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [result, setResult] = useState<any>(null)

  // Modificar la función handleTest para usar la URL hardcodeada
  async function handleTest() {
    // Eliminar la verificación de config.proxy
    if (!config.cliente_id) {
      toast({
        title: "Error",
        description: "La configuración no tiene un ID de cliente configurado",
        variant: "destructive",
      })
      return
    }

    setIsLoading(true)
    setResult(null)

    try {
      // Preparar los parámetros según el tipo de prueba
      const params: Record<string, string> = {}

      switch (testType) {
        case "buscarPaciente":
          if (!dni && !telefono) {
            toast({
              title: "Error",
              description: "Se requiere el DNI o el teléfono para buscar un paciente",
              variant: "destructive",
            })
            setIsLoading(false)
            return
          }
          if (dni) params.dni = dni
          if (telefono) params.telefono = telefono
          break

        case "verificarDisponibilidad":
          if (!fecha) {
            toast({
              title: "Error",
              description: "Se requiere la fecha para verificar disponibilidad",
              variant: "destructive",
            })
            setIsLoading(false)
            return
          }
          params.fecha = fecha
          if (doctorId) params.doctorId = doctorId
          break

        case "obtenerAgenda":
          if (!fechaDesde || !fechaHasta) {
            toast({
              title: "Error",
              description: "Se requieren las fechas de inicio y fin para obtener la agenda",
              variant: "destructive",
            })
            setIsLoading(false)
            return
          }
          params.fechaDesde = fechaDesde
          params.fechaHasta = fechaHasta
          if (doctorId) params.doctorId = doctorId
          break

        case "obtenerDoctores":
          // No se requieren parámetros adicionales
          break

        case "obtenerSubespecialidades":
          // No se requieren parámetros adicionales
          break

        case "buscarProfesionales":
          if (!busqueda) {
            toast({
              title: "Error",
              description: "Se requiere un texto de búsqueda para buscar profesionales",
              variant: "destructive",
            })
            setIsLoading(false)
            return
          }
          params.busqueda = busqueda
          break
      }

      // Realizar la petición
      const response = await fetch("/api/test-api", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          phoneNumberId: config.phoneNumberId,
          testType,
          params,
        }),
      })

      const data = await response.json()

      if (data.success) {
        setResult(data.result)
        toast({
          title: "Prueba exitosa",
          description: "La API respondió correctamente",
        })
      } else {
        setResult(data)
        toast({
          title: "Error en la prueba",
          description: data.error || "Error desconocido",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error al realizar la prueba:", error)
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Error desconocido al realizar la prueba",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Herramienta de Prueba de API</CardTitle>
        <CardDescription>
          Prueba la conexión con la API externa para verificar que todo funciona correctamente.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="test-type">Tipo de Prueba</Label>
          <Select value={testType} onValueChange={setTestType}>
            <SelectTrigger id="test-type">
              <SelectValue placeholder="Selecciona un tipo de prueba" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="buscarPaciente">Buscar Paciente por DNI/Teléfono</SelectItem>
              <SelectItem value="verificarDisponibilidad">Verificar Disponibilidad</SelectItem>
              <SelectItem value="obtenerAgenda">Obtener Agenda</SelectItem>
              <SelectItem value="obtenerDoctores">Obtener Doctores</SelectItem>
              <SelectItem value="obtenerSubespecialidades">Obtener Subespecialidades</SelectItem>
              <SelectItem value="buscarProfesionales">Buscar Profesionales</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {testType === "buscarPaciente" && (
          <>
            <div className="space-y-2">
              <Label htmlFor="dni">DNI del Paciente (opcional)</Label>
              <Input
                id="dni"
                value={dni}
                onChange={(e) => setDni(e.target.value)}
                placeholder="Ingrese el DNI del paciente"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="telefono">Teléfono del Paciente (opcional)</Label>
              <Input
                id="telefono"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="Ingrese el teléfono del paciente"
              />
              <p className="text-xs text-muted-foreground">Se requiere al menos uno: DNI o teléfono</p>
            </div>
          </>
        )}

        {testType === "verificarDisponibilidad" && (
          <>
            <div className="space-y-2">
              <Label htmlFor="fecha">Fecha</Label>
              <Input id="fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="doctor-id">ID del Doctor (opcional)</Label>
              <Input
                id="doctor-id"
                value={doctorId}
                onChange={(e) => setDoctorId(e.target.value)}
                placeholder="ID del doctor (opcional)"
              />
            </div>
          </>
        )}

        {testType === "obtenerAgenda" && (
          <>
            <div className="space-y-2">
              <Label htmlFor="fecha-desde">Fecha Desde</Label>
              <Input id="fecha-desde" type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fecha-hasta">Fecha Hasta</Label>
              <Input id="fecha-hasta" type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="doctor-id">ID del Doctor (opcional)</Label>
              <Input
                id="doctor-id"
                value={doctorId}
                onChange={(e) => setDoctorId(e.target.value)}
                placeholder="ID del doctor (opcional)"
              />
            </div>
          </>
        )}

        {testType === "buscarProfesionales" && (
          <div className="space-y-2">
            <Label htmlFor="busqueda">Texto de búsqueda</Label>
            <Input
              id="busqueda"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Nombre o especialidad"
            />
          </div>
        )}

        <div className="pt-4">
          <Button onClick={handleTest} disabled={isLoading || !config.proxy || !config.cliente_id}>
            {isLoading ? "Probando..." : "Probar API"}
          </Button>
        </div>

        {result && (
          <div className="mt-4 p-4 border rounded-md bg-gray-50 dark:bg-gray-900">
            <h4 className="font-medium mb-2">Resultado:</h4>
            <pre className="text-xs overflow-auto max-h-60 p-2 bg-white dark:bg-gray-800 rounded border">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-between">
        <p className="text-sm text-muted-foreground">Cliente ID: {config.cliente_id || "No configurado"}</p>
      </CardFooter>
    </Card>
  )
}
