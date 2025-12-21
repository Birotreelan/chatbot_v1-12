"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Plus, Pencil, Trash2 } from "lucide-react"
import type { SupportUser, WhatsAppConfig } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"

export function SupportUsersManager() {
  const [users, setUsers] = useState<Omit<SupportUser, "passwordHash">[]>([])
  const [configs, setConfigs] = useState<WhatsAppConfig[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<Omit<SupportUser, "passwordHash"> | null>(null)
  const [selectedTenant, setSelectedTenant] = useState<string>("all")
  const { toast } = useToast()

  const [formData, setFormData] = useState({
    username: "",
    password: "",
    displayName: "",
    email: "",
    tenantId: "",
    role: "support_agent" as "support_agent" | "super_admin",
    active: true,
  })

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      setIsLoading(true)
      const [usersRes, configsRes] = await Promise.all([fetch("/api/support-users"), fetch("/api/configs")])

      if (usersRes.ok) {
        const usersData = await usersRes.json()
        setUsers(usersData)
      }

      if (configsRes.ok) {
        const configsData = await configsRes.json()
        setConfigs(configsData)
      }
    } catch (error) {
      console.error("Error cargando datos:", error)
      toast({
        title: "Error",
        description: "No se pudieron cargar los datos",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  function openCreateDialog() {
    setEditingUser(null)
    setFormData({
      username: "",
      password: "",
      displayName: "",
      email: "",
      tenantId: "",
      role: "support_agent",
      active: true,
    })
    setIsDialogOpen(true)
  }

  function openEditDialog(user: Omit<SupportUser, "passwordHash">) {
    setEditingUser(user)
    setFormData({
      username: user.username,
      password: "",
      displayName: user.displayName,
      email: user.email || "",
      tenantId: user.tenantId || "",
      role: user.role,
      active: user.active,
    })
    setIsDialogOpen(true)
  }

  async function handleSubmit() {
    try {
      if (!formData.username || !formData.displayName) {
        toast({
          title: "Error",
          description: "Completa los campos requeridos",
          variant: "destructive",
        })
        return
      }

      if (!editingUser && !formData.password) {
        toast({
          title: "Error",
          description: "La contraseña es requerida para usuarios nuevos",
          variant: "destructive",
        })
        return
      }

      const url = editingUser ? `/api/support-users/${editingUser.id}` : "/api/support-users"
      const method = editingUser ? "PATCH" : "POST"

      const payload = {
        ...formData,
        tenantId: formData.tenantId || null,
      }

      // Si estamos editando y no hay contraseña nueva, no enviarla
      if (editingUser && !formData.password) {
        delete payload.password
      }

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Error al guardar usuario")
      }

      toast({
        title: "Éxito",
        description: `Usuario ${editingUser ? "actualizado" : "creado"} correctamente`,
      })

      setIsDialogOpen(false)
      loadData()
    } catch (error) {
      console.error("Error guardando usuario:", error)
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Error al guardar usuario",
        variant: "destructive",
      })
    }
  }

  async function handleDelete(userId: string) {
    if (!confirm("¿Estás seguro de eliminar este usuario?")) return

    try {
      const response = await fetch(`/api/support-users/${userId}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        throw new Error("Error al eliminar usuario")
      }

      toast({
        title: "Éxito",
        description: "Usuario eliminado correctamente",
      })

      loadData()
    } catch (error) {
      console.error("Error eliminando usuario:", error)
      toast({
        title: "Error",
        description: "Error al eliminar usuario",
        variant: "destructive",
      })
    }
  }

  const filteredUsers = selectedTenant === "all" ? users : users.filter((u) => u.tenantId === selectedTenant)

  const uniqueTenants = Array.from(new Set(configs.map((c) => c.cliente_id).filter(Boolean))) as string[]

  if (isLoading) {
    return <div className="text-center py-8">Cargando...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Select value={selectedTenant} onValueChange={setSelectedTenant}>
            <SelectTrigger className="w-[250px]">
              <SelectValue placeholder="Filtrar por cliente" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los clientes</SelectItem>
              {uniqueTenants.map((tenantId) => {
                const config = configs.find((c) => c.cliente_id === tenantId)
                return (
                  <SelectItem key={tenantId} value={tenantId}>
                    {config?.displayName || tenantId}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          Nuevo Usuario
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Usuarios de Soporte</CardTitle>
          <CardDescription>
            {filteredUsers.length} usuario{filteredUsers.length !== 1 ? "s" : ""} encontrado
            {filteredUsers.length !== 1 ? "s" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuario</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No hay usuarios registrados
                  </TableCell>
                </TableRow>
              ) : (
                filteredUsers.map((user) => {
                  const config = configs.find((c) => c.cliente_id === user.tenantId)
                  return (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.username}</TableCell>
                      <TableCell>{user.displayName}</TableCell>
                      <TableCell>{user.email || "-"}</TableCell>
                      <TableCell>{config?.displayName || user.tenantId || "Todos"}</TableCell>
                      <TableCell>
                        <Badge variant={user.role === "super_admin" ? "default" : "secondary"}>
                          {user.role === "super_admin" ? "Super Admin" : "Agente"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={user.active ? "default" : "secondary"}>
                          {user.active ? "Activo" : "Inactivo"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="icon" onClick={() => openEditDialog(user)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(user.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingUser ? "Editar Usuario" : "Nuevo Usuario"}</DialogTitle>
            <DialogDescription>
              {editingUser ? "Modifica los datos del usuario" : "Completa los datos para crear un nuevo usuario"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Usuario *</Label>
              <Input
                id="username"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                disabled={!!editingUser}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Contraseña {editingUser ? "(dejar vacío para no cambiar)" : "*"}</Label>
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="displayName">Nombre completo *</Label>
              <Input
                id="displayName"
                value={formData.displayName}
                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="tenantId">Cliente</Label>
              <Select
                value={formData.tenantId}
                onValueChange={(value) => setFormData({ ...formData, tenantId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar cliente" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Ninguno (todos los clientes)</SelectItem>
                  {configs
                    .filter((c) => c.cliente_id)
                    .map((config) => (
                      <SelectItem key={config.id} value={config.cliente_id!}>
                        {config.displayName}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="role">Rol</Label>
              <Select value={formData.role} onValueChange={(value: any) => setFormData({ ...formData, role: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="support_agent">Agente de Soporte</SelectItem>
                  <SelectItem value="super_admin">Super Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="active"
                checked={formData.active}
                onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                className="rounded border-gray-300"
              />
              <Label htmlFor="active">Usuario activo</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit}>{editingUser ? "Actualizar" : "Crear"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
