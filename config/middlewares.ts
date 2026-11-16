import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Middlewares => {
  // Origen del bucket público de Supabase (https://<ref>.supabase.co), sin path.
  // Es opcional: en desarrollo con el proveedor local no hace falta. Si falta con S3 activo,
  // config/plugins.ts falla con un mensaje claro.
  const publicUrl = env('SUPABASE_PUBLIC_URL');
  let supabaseOrigins: string[] = [];
  if (publicUrl) {
    try {
      supabaseOrigins = [new URL(publicUrl).origin];
    } catch {
      throw new Error(
        'SUPABASE_PUBLIC_URL no es una URL válida (ej: https://<ref>.supabase.co/storage/v1/object/public/<bucket>).'
      );
    }
  }

  return [
    'strapi::logger',
    'strapi::errors',
    {
      name: 'strapi::security',
      config: {
        contentSecurityPolicy: {
          useDefaults: true,
          directives: {
            // market-assets.strapi.io es parte del default de Strapi: hay que repetirlo porque
            // img-src reemplaza el array por defecto.
            'img-src': [
              "'self'",
              'data:',
              'blob:',
              'https://market-assets.strapi.io',
              ...supabaseOrigins,
            ],
            'media-src': ["'self'", 'data:', 'blob:', ...supabaseOrigins],
            upgradeInsecureRequests: null,
          },
        },
      },
    },
    'strapi::cors',
    'strapi::poweredBy',
    'strapi::query',
    'strapi::body',
    'strapi::session',
    'strapi::favicon',
    'strapi::public',
  ];
};

export default config;
