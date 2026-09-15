# Acotar el trabajo del equipo externo al panel Proxmox

Guía de configuración, 15/9/2026. Complementa `PANEL_PROXMOX_HANDOFF.md`.

---

## Lo primero, para no partir de una expectativa equivocada

**Git no restringe a nivel de archivo.** Quien clona el repositorio puede editar
cualquier cosa en su máquina, y además **necesita el proyecto completo**: una app
de Next.js no compila con 16 archivos sueltos, porque el panel importa
componentes de `components/ui/`, tipos de `lib/`, y se sirve desde `app/`.

Entonces el control no está en *qué pueden abrir*, sino en **qué se puede mergear
a `main` y llegar a producción**. Eso sí se controla, y de forma efectiva.

---

## Opción recomendada: fork + Pull Requests

El equipo trabaja en **su propio fork**. No tiene permiso de escritura sobre el
repositorio original.

**Ventajas**

- Riesgo cero: no pueden desplegar a producción ni por error.
- Total libertad para experimentar en su copia.
- Todo lo que quieran incorporar pasa por un Pull Request que revisás vos.

**Cómo se configura**

1. El equipo entra a https://github.com/Birotreelan/chatbot_v1-12 y hace **Fork**.
2. No hace falta agregarlos como colaboradores. Si el repo es privado, alcanza con
   darles permiso **Read**.
3. Trabajan en su fork y abren PRs contra `main`.

**Para que puedan probar en Vercel**, conectan su fork a un proyecto de Vercel
propio, con sus propias variables de entorno (idealmente apuntando a una base de
datos de prueba, no a la de producción).

---

## Si preferís que trabajen en el mismo repositorio

Sirve si querés que compartan las URLs de preview de tu proyecto de Vercel. Hace
falta configurar tres cosas en GitHub:

### 1. Permiso de colaborador

`Settings → Collaborators and teams → Add people`

Darles rol **Write** (necesario para crear ramas). Con las protecciones de abajo,
Write **no** alcanza para tocar `main`.

### 2. Protección de la rama `main`

`Settings → Branches → Add branch protection rule`

Rama: `main`. Activar:

- ☑ **Require a pull request before merging**
- ☑ **Require approvals** → 1
- ☑ **Require review from Code Owners** ← *esta es la clave*
- ☑ **Do not allow bypassing the above settings**

Con "Require review from Code Owners", el archivo `.github/CODEOWNERS` pasa a ser
vinculante: un PR que toque `lib/`, `app/api/` o el panel original **no se puede
mergear sin tu aprobación**, aunque el PR lo apruebe otra persona.

### 3. Completar el CODEOWNERS

En `.github/CODEOWNERS` hay que reemplazar `@equipo-proxmox` por el usuario o
equipo real de GitHub:

```
/app/support_proxmox/               @usuario-del-equipo @Birotreelan
/components/support-proxmox/        @usuario-del-equipo @Birotreelan
```

Si son varias personas, conviene crear un team en la organización y usar
`@Birotreelan/proxmox`.

---

## Qué queda protegido

Con lo anterior, un PR del equipo externo que toque estas rutas **te pide
aprobación sí o sí**:

| Ruta | Por qué importa |
|---|---|
| `app/api/` | Backend compartido por los dos paneles |
| `lib/` | Autenticación, tipos, lógica del bot |
| `middleware.ts` | Autenticación, SSO, iframe |
| `components/dashboard/` | Dashboard de administración |
| `components/ui/` | Componentes visuales de toda la app |
| `app/support/` y `components/support/` | El panel en producción |
| `package.json`, `vercel.json` | Dependencias y build |

Y estas las pueden aprobar entre ellos:

| Ruta |
|---|
| `app/support_proxmox/` |
| `components/support-proxmox/` |

---

## Lo que esto no cubre

- **No impide que vean el resto del código.** Si eso es un requisito, la única
  forma real es el fork con acceso de lectura, o directamente extraer el panel a
  un proyecto aparte — lo cual es un trabajo bastante mayor, porque habría que
  separar también los componentes compartidos y la autenticación.
- **No revisa el contenido por vos.** CODEOWNERS te asegura que te van a pedir la
  revisión; la calidad del cambio la seguís mirando vos.
- **Las variables de entorno son acceso real.** Si les pasás las credenciales de
  producción, tienen acceso a la base y a las APIs, independientemente de lo que
  diga GitHub. Para trabajar en el panel conviene darles un entorno de prueba.
