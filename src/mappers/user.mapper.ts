import type { User } from '../db/schema';
import { effectivePermissions, isAdmin } from '../domain/permissions';

export function toSessionUser(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    permissions: effectivePermissions(user),
    avatarUrl: user.avatarUrl,
  };
}

export type SessionUser = ReturnType<typeof toSessionUser>;

export function toProfileDto(user: User) {
  return {
    ...toSessionUser(user),
    headline: user.headline,
    bio: user.bio,
    instagram: user.instagram,
    showOnAbout: user.showOnAbout,
  };
}

export function toManagedUserDto(user: User) {
  return {
    ...toSessionUser(user),
    permissions: isAdmin(user) ? [] : user.permissions,
    twoFactorEnabled: Boolean(user.totpSecret),
    lockedUntil: user.lockedUntil && user.lockedUntil > new Date() ? user.lockedUntil : null,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

export function toTeamMemberDto(user: User) {
  return {
    id: user.id,
    name: user.name,
    avatarUrl: user.avatarUrl,
    headline: user.headline,
    bio: user.bio,
    instagram: user.instagram,
  };
}
