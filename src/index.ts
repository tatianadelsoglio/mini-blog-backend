import type { Core } from '@strapi/strapi';

const PUBLIC_ROLE_TYPE = 'public';
const PUBLIC_CONTENT_TYPES = ['api::post.post', 'api::category.category', 'api::about.about'] as const;

// Los single types solo exponen `find`; los collection types, `find` y `findOne`.
const getReadActions = (strapi: Core.Strapi, uid: (typeof PUBLIC_CONTENT_TYPES)[number]) => {
  const isSingleType = strapi.contentType(uid).kind === 'singleType';
  const methods = isSingleType ? ['find'] : ['find', 'findOne'];
  return methods.map((method) => `${uid}.${method}`);
};

/**
 * Deja el rol Public con permisos de solo lectura sobre post, category y about.
 * Es idempotente: crea los que faltan y quita cualquier otro permiso del rol
 * sobre esos content types (create, update, delete).
 */
const ensurePublicPermissions = async (strapi: Core.Strapi) => {
  const role = await strapi.db
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: PUBLIC_ROLE_TYPE } });

  if (!role) {
    strapi.log.warn('[permisos] No existe el rol Public; se omite la configuración de permisos.');
    return;
  }

  const permissionQuery = strapi.db.query('plugin::users-permissions.permission');
  const current = await permissionQuery.findMany({ where: { role: role.id } });

  for (const uid of PUBLIC_CONTENT_TYPES) {
    const allowed = getReadActions(strapi, uid);

    for (const permission of current) {
      const isOwnAction = permission.action.startsWith(`${uid}.`);
      if (isOwnAction && !allowed.includes(permission.action)) {
        await permissionQuery.delete({ where: { id: permission.id } });
        strapi.log.info(`[permisos] Public: se quitó ${permission.action}`);
      }
    }

    for (const action of allowed) {
      if (!current.some((permission) => permission.action === action)) {
        await permissionQuery.create({ data: { action, role: role.id } });
        strapi.log.info(`[permisos] Public: se agregó ${action}`);
      }
    }
  }
};

export default {
  register() {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await ensurePublicPermissions(strapi);
  },
};
