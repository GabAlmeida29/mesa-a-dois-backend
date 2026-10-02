export const ROLES = ['admin', 'member'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'restaurants:create',
  'restaurants:update',
  'restaurants:delete',
  'dishes:manage',
  'analytics:view',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export interface Authorizable {
  role: string;
  permissions: readonly string[];
}

export const isAdmin = (user: Authorizable) => user.role === 'admin';

export const hasPermission = (user: Authorizable, permission: Permission) =>
  isAdmin(user) || user.permissions.includes(permission);

export function effectivePermissions(user: Authorizable): Permission[] {
  return PERMISSIONS.filter((p) => hasPermission(user, p));
}
