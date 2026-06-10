# Tablero de trabajo — Backend + Frontend

Aplicación multiusuario de seguimiento de tareas (kanban) y calendario, con login por
email/contraseña, permisos por tablero y control de concurrencia.

## Arquitectura

```
tablero/
├── server/
│   ├── index.js   API REST (Express)
│   ├── auth.js    JWT + bcrypt + middlewares de permisos
│   └── db.js      Esquema y conexión a la base
├── public/
│   └── index.html Frontend (se sirve desde el mismo servidor)
├── package.json
└── data.db        Base SQLite (se crea sola al primer arranque)
```

- **Backend**: Node.js + Express.
- **Base de datos**: SQLite mediante el módulo nativo `node:sqlite` (incluido en Node 22+, sin compilación). Para producción con varios procesos o alta carga, ver "Migración a PostgreSQL".
- **Seguridad**: contraseñas con bcrypt (hash + salt); sesiones con JWT (7 días); cada ruta de tablero verifica que el usuario sea miembro; actualización de tareas con bloqueo optimista por `version` (evita que dos usuarios se pisen los cambios).
- **Frontend**: HTML/JS sin framework, servido como estático. Sincroniza cada 6 s.

## Requisitos

- **Node.js 22 o superior** (obligatorio: usa `node:sqlite`). Verificá con `node -v`.

## Puesta en marcha local

```bash
cd tablero
npm install
JWT_SECRET="poné-acá-una-cadena-larga-y-secreta" npm start
```

Abrí http://localhost:3000

## Variables de entorno

| Variable     | Descripción                          | Default                |
|--------------|--------------------------------------|------------------------|
| `PORT`       | Puerto de escucha                    | `3000`                 |
| `JWT_SECRET` | Clave para firmar los tokens         | valor inseguro de dev  |

> **Importante**: en producción definí siempre un `JWT_SECRET` propio y secreto.
> Si cambia, todas las sesiones activas se invalidan.

## Despliegue

### Opción A — Servidor propio (VPS) con PM2

```bash
npm install -g pm2
JWT_SECRET="..." pm2 start server/index.js --name tablero
pm2 save && pm2 startup
```

Poné un Nginx adelante como reverse proxy y certificado TLS (Let's Encrypt).
El archivo `data.db` debe estar en disco persistente y entrar en tus backups.

### Opción B — Plataformas (Render, Railway, Fly.io)

- Build: `npm install`
- Start: `npm start`
- Definí `JWT_SECRET` como variable de entorno.
- Montá un **volumen persistente** para `data.db` (sin volumen, la base se borra
  en cada redeploy).

## Endpoints principales

| Método | Ruta                                   | Descripción                         |
|--------|----------------------------------------|-------------------------------------|
| POST   | `/api/register`                        | Crear cuenta                        |
| POST   | `/api/login`                           | Iniciar sesión → token              |
| GET    | `/api/boards`                          | Tableros del usuario                |
| POST   | `/api/boards`                          | Crear tablero                       |
| POST   | `/api/boards/:id/members`              | Invitar usuario (solo propietario)  |
| GET/POST | `/api/boards/:id/tasks`              | Listar / crear tareas               |
| PATCH  | `/api/boards/:id/tasks/:tid`           | Editar/mover (envía `version`)      |
| DELETE | `/api/boards/:id/tasks/:tid`           | Eliminar tarea                      |
| GET/POST | `/api/boards/:id/events`             | Listar / crear eventos              |
| DELETE | `/api/boards/:id/events/:eid`          | Eliminar evento                     |

Todas las rutas salvo register/login requieren cabecera `Authorization: Bearer <token>`.

## Control de concurrencia

Cada tarea tiene un campo `version`. Al editar, el cliente envía la versión que tenía;
si otro usuario ya la modificó, el servidor responde **409 Conflict** con el estado
actual, en lugar de sobrescribir a ciegas. El frontend recarga y muestra el cambio.

## Migración a PostgreSQL (producción robusta)

`node:sqlite` es ideal para empezar y para equipos chicos. Si necesitás varios procesos
concurrentes, réplicas o mayor volumen, conviene PostgreSQL:

1. `npm install pg`
2. Reescribí `server/db.js` usando un `Pool` de `pg`.
3. Ajustes de sintaxis: parámetros `$1, $2…` en vez de `?`; `SERIAL`/`IDENTITY` en vez
   de `AUTOINCREMENT`; `RETURNING id` para recuperar el id insertado; `datetime('now')`
   → `now()`.
La lógica de rutas, auth y permisos no cambia.

## Seguridad para producción (checklist)

- [ ] `JWT_SECRET` propio, largo y secreto.
- [ ] Servir siempre por HTTPS.
- [ ] Backups periódicos de `data.db` (o de Postgres).
- [ ] Considerar rate limiting en `/api/login` y `/api/register`.
