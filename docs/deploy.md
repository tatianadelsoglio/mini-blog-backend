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
| Build Command | `npm ci --include=dev && NODE_OPTIONS=--max-old-space-size=460 npm run build` |
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

1. Deploy inicial (puede fallar el admin hasta cargar `PUBLIC_URL`; cargarla y redeployar).
2. Abrir `https://<servicio>.onrender.com/admin` y crear el primer usuario administrador (solo si la base es nueva).
3. Crear la página **About** y publicarla (single type, hasta publicarla la API responde 404).
4. Los permisos públicos (solo `find` y `findOne` en post y category, `find` en about) se configuran solos al arrancar (`src/index.ts`).

### Memoria (512 MB)

El build del panel de admin (Vite) es lo que más memoria consume: en una medición local el proceso de build llegó a ~2 GB de memoria residente, y el plan Free de Render tiene 512 MB. Por eso `NODE_OPTIONS=--max-old-space-size=460` va **solo en el Build Command** (mejor que como variable de entorno, que también limitaría el runtime). El runtime de Strapi entra en 512 MB sin ese límite.

El tope de heap hace que el recolector de basura sea más agresivo, pero no limita la memoria nativa de Vite/esbuild, así que **no está garantizado** que el build pase. Si falla con "Ran out of memory" o `JavaScript heap out of memory`:

1. **Plan B (gratis): buildear fuera de Render.** Correr `npm ci --include=dev && npm run build` en GitHub Actions o en local, y desplegar el resultado (`dist/` y `build/`) en lugar de compilar en Render. Requiere cambiar el Build Command a algo mínimo (p. ej. `npm ci --omit=dev`) y versionar o publicar los artefactos; el admin compilado depende de `PUBLIC_URL`.
2. Subir temporalmente el plan de Render solo para hacer el deploy y volver a Free.
3. Pasar a un plan pago.

## 3. Ping para que no se duerma todo

Workflow `.github/workflows/keep-alive.yml`: corre cada 3 días y a mano (**Actions → Keep alive → Run workflow**). Hace `GET <STRAPI_URL>/api/posts?pagination[pageSize]=1`, que despierta Render y hace una consulta real a Supabase (Supabase pausa los proyectos tras ~7 días sin actividad).

1. En el repo de GitHub: **Settings → Secrets and variables → Actions → New repository secret**.
2. Nombre: `STRAPI_URL`. Valor: `https://<servicio>.onrender.com` (sin barra final ni path).
3. Correr el workflow a mano una vez para verificar que da `HTTP 200`.

**Importante:** GitHub desactiva los workflows programados si el repositorio pasa **60 días sin actividad**. Si pasa, aparece un aviso en la pestaña Actions y hay que reactivarlo desde ahí (o hacer un commit). Un push cada tanto alcanza para evitarlo.

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
