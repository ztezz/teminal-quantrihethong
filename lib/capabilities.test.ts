import assert from 'node:assert/strict';
import test from 'node:test';
import { hasCapability, type Capability } from './capabilities';
import type { Role } from './sqlite-database';

test('capability matrix preserves the existing role permissions', () => {
  const capabilities: Capability[] = ['audit:read', 'jobs:manage', 'overview:read', 'sqlite:dangerous', 'sqlite:manage', 'system:manage', 'terminal:use', 'users:manage'];
  const expected: Record<Role, Capability[]> = {
    viewer: [],
    operator: [],
    admin: ['audit:read', 'jobs:manage', 'overview:read', 'sqlite:manage', 'system:manage', 'terminal:use'],
    root: capabilities
  };

  for (const role of ['viewer', 'operator', 'admin', 'root'] as const) {
    for (const capability of capabilities) assert.equal(hasCapability(role, capability), expected[role].includes(capability), `${role} ${capability}`);
  }
});
