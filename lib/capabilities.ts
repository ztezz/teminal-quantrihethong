import type { Role } from './sqlite-database';

export type Capability =
  | 'audit:read'
  | 'jobs:manage'
  | 'overview:read'
  | 'sqlite:dangerous'
  | 'sqlite:manage'
  | 'system:manage'
  | 'terminal:use'
  | 'users:manage';

const capabilitiesByRole: Record<Role, ReadonlySet<Capability>> = {
  viewer: new Set(),
  operator: new Set(),
  admin: new Set(['audit:read', 'jobs:manage', 'overview:read', 'sqlite:manage', 'system:manage', 'terminal:use']),
  root: new Set(['audit:read', 'jobs:manage', 'overview:read', 'sqlite:dangerous', 'sqlite:manage', 'system:manage', 'terminal:use', 'users:manage'])
};

export function hasCapability(role: Role, capability: Capability): boolean {
  return capabilitiesByRole[role].has(capability);
}
