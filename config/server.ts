import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Server => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  // URL pública del backend (https://<servicio>.onrender.com). Necesaria para el admin y los links.
  url: env('PUBLIC_URL', ''),
  // Detrás del proxy de Render hay que confiar en X-Forwarded-* (cookies seguras, IP real).
  proxy: { koa: env.bool('IS_PROXIED', false) },
  app: {
    keys: env.array('APP_KEYS')!,
  },
  webhooks: {
    populateRelations: env.bool('WEBHOOKS_POPULATE_RELATIONS', false),
  },
});

export default config;
