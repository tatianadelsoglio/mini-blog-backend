import type { Core } from '@strapi/strapi';

const allowedMediaTypes = [
  'image/*',
  'video/*',
  'audio/*',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.*',
  'text/plain',
  'text/csv',
];

const deniedExecutableTypes = [
  'application/vnd.microsoft.portable-executable',
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-executable',
  'application/x-dosexec',
  'application/x-sh',
  'text/x-shellscript',
  'application/x-mach-binary',
];

const requiredS3Variables = [
  'SUPABASE_S3_ENDPOINT',
  'SUPABASE_S3_REGION',
  'SUPABASE_S3_ACCESS_KEY_ID',
  'SUPABASE_S3_SECRET_ACCESS_KEY',
  'SUPABASE_S3_BUCKET',
  'SUPABASE_PUBLIC_URL',
];

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => {
  // En producción siempre S3 (el disco de Render es efímero). En desarrollo se usa el
  // proveedor local salvo que se pida explícitamente UPLOAD_PROVIDER=s3.
  const useS3 = env('NODE_ENV') === 'production' || env('UPLOAD_PROVIDER') === 's3';

  if (useS3) {
    const missing = requiredS3Variables.filter((name) => !env(name));
    if (missing.length > 0) {
      throw new Error(
        `Faltan variables de entorno para Supabase Storage: ${missing.join(', ')}. Ver .env.example.`
      );
    }
  }

  return {
    'users-permissions': {
      config: {
        jwtManagement: 'refresh',
        sessions: {
          httpOnly: true,
        },
      },
    },
    upload: {
      config: {
        ...(useS3 && {
          provider: 'aws-s3',
          providerOptions: {
            // Las URLs públicas de los archivos salen de acá (bucket público de Supabase).
            baseUrl: env('SUPABASE_PUBLIC_URL'),
            s3Options: {
              endpoint: env('SUPABASE_S3_ENDPOINT'),
              region: env('SUPABASE_S3_REGION'),
              forcePathStyle: true,
              credentials: {
                accessKeyId: env('SUPABASE_S3_ACCESS_KEY_ID')!,
                secretAccessKey: env('SUPABASE_S3_SECRET_ACCESS_KEY')!,
              },
              params: {
                Bucket: env('SUPABASE_S3_BUCKET'),
                // Supabase Storage no soporta ACLs: sin esta clave el provider enviaría public-read.
                ACL: undefined,
              },
            },
          },
          actionOptions: {
            upload: {},
            uploadStream: {},
            delete: {},
          },
        }),
        security: {
          allowedTypes: allowedMediaTypes,
          deniedTypes: deniedExecutableTypes,
        },
      },
    },
  };
};

export default config;
