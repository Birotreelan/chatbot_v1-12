import Link from "next/link"
import type { WhatsAppConfig } from "@/lib/types"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DeleteWhatsAppConfig } from "@/components/dashboard/delete-whatsapp-config"

interface WhatsAppConfigListProps {
  configs: WhatsAppConfig[]
}

export function WhatsAppConfigList({ configs }: WhatsAppConfigListProps) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead>ID de Número</TableHead>
            <TableHead>ID de Asistente</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Mensajes</TableHead>
            <TableHead>Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {configs.map((config) => (
            <TableRow key={config.id}>
              <TableCell className="font-medium">{config.displayName}</TableCell>
              <TableCell>{config.phoneNumberId}</TableCell>
              <TableCell>
                <span className="truncate max-w-[150px] inline-block">{config.assistantId}</span>
              </TableCell>
              <TableCell>
                {config.active ? (
                  <Badge variant="success">Activo</Badge>
                ) : (
                  <Badge variant="destructive">Inactivo</Badge>
                )}
              </TableCell>
              <TableCell>
                {config.stats?.messagesReceived || 0} recibidos
                <br />
                {config.stats?.messagesProcessed || 0} procesados
              </TableCell>
              <TableCell>
                <div className="flex space-x-2">
                  <Link href={`/dashboard/config/${config.id}`}>
                    <Button variant="outline" size="sm">
                      Editar
                    </Button>
                  </Link>
                  <DeleteWhatsAppConfig id={config.id} name={config.displayName} />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
