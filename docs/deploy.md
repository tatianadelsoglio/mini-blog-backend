# Guía de deploy

Backend Strapi 5 en **Render** (plan Free), base Postgres y archivos en **Supabase**, ping de GitHub Actions para que nada se duerma.

> Plan Free de Render: el servicio se duerme tras 15 min sin tráfico (el primer request tarda ~30–60 s) y el disco se borra en cada reinicio. Por eso las imágenes van a Supabase Storage y no al disco.

## 1. Supabase Storage (imágenes)

1. En Supabase: **Storage → New bucket**, nombre `uploads`, marcado como **Public bucket**.
2. **Storage → S3 Connection → New access key**. Anotar `Access key ID` y `Secret access key` (el secret se muestra una sola vez).
3. En esa misma pantalla están el endpoint y la región:
   - `SUPABASE_S3_ENDPOINT` = `https://<project-ref>.storage.supabase.co/storage/v1/s3`
   - `SUPABASE_S3_REGION` = la del proyecto (p. ej. `sa-east-1`)
4. `SUPABASE_PUBLIC_URL` = `https://<project-ref>.supabase.co/storage/v1/object/public/<bucket>` (incluye el nombre del bucket, sin barra final). Las URLs que devuelve la API salen de ahí.

## 2. Render

### Opción A: Blueprint (`render.yaml`)

1. Render → **New → Blueprint** → elegir este repo. Render lee `render.yaml`.
2. Completar las variables marcadas `sync: false` (ver tabla abajo).
3. Crear el servicio. Los secretos de Strapi se generan solos.

### Opción B: a mano

**New → Web Service** con este repo y:

| Campo | Valor |
|---|---|
| Runtime | Node |
| Plan | Free |
| Build Command | `npm ci --include=dev && NODE_OPTIONS=--max-old-space-size=1536 npm run build` |
| Start Command | `npm run start` |
| Health Check Path | `/_health` |
| Node | 22 (se toma de `.nvmrc`) |

`--include=dev` es necesario: Render define `NODE_ENV=production` y sin devDependencies no hay `typescript` para compilar Strapi.

### Variables de entorno

Referencia completa y comentada en `.env.example`.

| Variable | Valor en Render |
|---|---|
| `NODE_ENV` | `production` |
| `IS_PROXIED` | `true` |
| `PUBLIC_URL` | `https://<tu-servicio>.onrender.com` (después del primer deploy, cuando se conoce la URL) |
| `APP_KEYS`, `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `TRANSFER_TOKEN_SALT`, `JWT_SECRET`, `ENCRYPTION_KEY` | Generados por el Blueprint. Si reusás una base existente, copiá los de tu `.env` local (cambiar `API_TOKEN_SALT` invalida los API tokens ya creados) |
| `DATABASE_CLIENT` | `postgres` |
| `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USERNAME`, `DATABASE_PASSWORD` | Datos del connection pooler de Supabase |
| `DATABASE_SSL` | `true` |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | `true` |
| `DATABASE_SSL_CA` | Contenido completo del certificado CA de Supabase (ver abajo) |
| `DATABASE_POOL_MIN` / `DATABASE_POOL_MAX` | `0` / `5` |
| `SUPABASE_S3_*`, `SUPABASE_PUBLIC_URL` | Ver sección 1 |

`PORT` lo define Render; no hace falta cargarlo.

### Certificado CA de la base (validación SSL)

La conexión a Postgres valida el certificado del servidor (`DATABASE_SSL_REJECT_UNAUTHORIZED=true`), así que Strapi necesita el CA de Supabase.

1. Supabase → **Project Settings → Database → SSL Configuration → Download certificate** (archivo `.crt`).
2. **En Render:** abrir el `.crt` con un editor de texto, copiar todo (de `-----BEGIN CERTIFICATE-----` a `-----END CERTIFICATE-----`) y pegarlo como valor de `DATABASE_SSL_CA`. El dashboard acepta valores de varias líneas; si el PEM queda en una sola línea con `
` literales, también funciona.
3. **En local:** dejar el `.crt` en la raíz del repo (o donde quieras) y apuntar `DATABASE_SSL_CA_FILE` a esa ruta. Los `*.crt` y `*.pem` están en `.gitignore`: el certificado no se sube al repo.

Si falta el CA con la validación activa, Strapi no arranca y el log muestra `SELF_SIGNED_CERT_IN_CHAIN`.

### Primer deploy

1. **Orden de `PUBLIC_URL`:** la URL del servicio solo se conoce al crearlo y el panel de admin la incorpora en el build. Dos caminos:
   - Si el nombre `mini-blog-backend` está libre, la URL va a ser `https://mini-blog-backend.onrender.com` y se puede cargar `PUBLIC_URL` ya en el Blueprint.
   - Si no (Render agrega un sufijo al nombre), dejar `PUBLIC_URL` vacía, hacer el primer deploy, copiar la URL que muestra Render, cargarla en `PUBLIC_URL` y volver a deployar (**Manual Deploy → Clear build cache & deploy**) para que el admin se rebuildee con la URL correcta. Sin `PUBLIC_URL`, el admin y los links absolutos pueden apuntar a una dirección incorrecta.
2. Abrir `https://<servicio>.onrender.com/admin` y crear el primer usuario administrador (solo si la base es nueva).
3. Crear la página **About** y publicarla (single type, hasta publicarla la API responde 404).
4. Los permisos públicos (solo `find` y `findOne` en post y category, `find` en about) se configuran solos al arrancar (`src/index.ts`).
   - **Importante:** el bootstrap (`src/index.ts`) restablece esos permisos en **cada arranque**: deja al rol Public solo con `find` y `findOne` en post y category, y `find` en about, y quita cualquier otro permiso del rol sobre esos tres content types (por ejemplo, uno activado a mano en el admin). Para cambiarlos hay que modificar el código, no el admin. Los permisos sobre otros content types y los de otros roles no se tocan. Si el rol Public no existe, el arranque solo deja un aviso en el log y la API responde 403.

### Memoria

- **Build:** según la documentación de Render, los builds corren en el pipeline de build de Render, en máquinas aparte de la instancia del servicio (tier Starter del build pipeline, 8 GB de RAM en workspaces Hobby). Los 512 MB del plan Free **no** aplican al build.
- **Runtime:** los 512 MB del plan Free aplican solo al servicio ya desplegado. Strapi en reposo usa ~164 MB (medido en local, en desarrollo).

El build del panel de admin (Vite) consume bastante: en local necesita más de 1 GB de heap (con `--max-old-space-size` de 460, 768 y 1024 MB falla con `JavaScript heap out of memory`; con 1536 MB pasa en ~45 s, con un pico de ~2 GB de memoria residente). Por eso `NODE_OPTIONS=--max-old-space-size=1536` va **solo en el Build Command**, no como variable de entorno (que limitaría también el runtime).

**Plan B, solo si el build falla por memoria en Render** (error `Ran out of memory` o `JavaScript heap out of memory` en el log del build): buildear fuera de Render y desplegar el resultado.

1. Correr `npm ci --include=dev && npm run build` en GitHub Actions (el runner tiene ~7 GB) o en local.
2. Desplegar el resultado (`dist/` y `build/`) en lugar de compilar en Render, con un Build Command mínimo (p. ej. `npm ci --omit=dev`) y publicando los artefactos.
3. El admin compilado depende de `PUBLIC_URL`: hay que rebuildear si cambia.

Este plan B no está implementado; se documenta únicamente como contingencia.

## 3. Ping para que no se duerma todo

Workflow `.github/workflows/keep-alive.yml`: corre cada 3 días y a mano (**Actions → Keep alive → Run workflow**). Hace `GET <STRAPI_URL>/api/posts?pagination[pageSize]=1`, que despierta Render y hace una consulta real a Supabase (Supabase pausa los proyectos tras ~7 días sin actividad).

1. En el repo de GitHub: **Settings → Secrets and variables → Actions → New repository secret**.
2. Nombre: `STRAPI_URL`. Valor: `https://<servicio>.onrender.com` (sin barra final ni path).
3. Correr el workflow a mano una vez para verificar que da `HTTP 200`.

**Importante:** GitHub desactiva los workflows programados si el repositorio pasa **60 días sin actividad**. Si pasa, aparece un aviso en la pestaña Actions y hay que reactivarlo desde ahí (o hacer un commit). Un push cada tanto alcanza para evitarlo.

**Si cambia la URL del backend (`STRAPI_URL`):**

1. Actualizar el secret `STRAPI_URL` en GitHub (Settings → Secrets and variables → Actions) y correr el workflow a mano para comprobarlo.
2. Actualizar `PUBLIC_URL` en Render y redeployar (el admin se rebuildea con la URL nueva).
3. Actualizar la variable del frontend que apunta a la API y redeployar el frontend.

## 4. Webhook de revalidación hacia el frontend

Strapi guarda los webhooks en la base de datos, así que no viajan con el código: hay que crearlo una vez por cada base nueva.

1. Admin → **Settings → Webhooks → Create new webhook**.
2. **Name:** `Revalidar frontend`.
3. **URL:** `https://<frontend>/api/revalidate`.
4. **Headers:** `x-revalidate-secret` = el mismo valor que la variable de entorno de revalidación del frontend.
5. **Events** (en *Entry*): `create`, `update`, `delete`, `publish`, `unpublish`. Aplican a todos los content types; el frontend recibe el modelo en el payload (`model`: `post`, `category` o `about`).
   - `category` no usa Draft & Publish: solo dispara create, update y delete.
6. Guardar y probar con **Trigger**.

El endpoint `/api/revalidate` del frontend debe validar el header antes de revalidar.

## 5. Verificación rápida

```bash
curl -i https://<servicio>.onrender.com/_health                              # 204
curl "https://<servicio>.onrender.com/api/posts?pagination[pageSize]=1" -g   # 200
curl https://<servicio>.onrender.com/api/categories -g                       # 200
curl https://<servicio>.onrender.com/api/about                               # 200 (404 si no está publicada)
```

Subir una imagen desde el admin y comprobar que la URL devuelta empieza con `SUPABASE_PUBLIC_URL` y abre en el navegador.
