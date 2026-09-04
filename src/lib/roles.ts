export type AppRole = "admin" | "manager" | "team";

const ROLE_RANK: Record<AppRole, number> = { team: 0, manager: 1, admin: 2 };

export function isAppRole(value: unknown): value is AppRole {
  return value === "admin" || value === "manager" || value === "team";
}

export function roleAtLeast(role: AppRole, required: AppRole) {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

export function canManageReports(role: AppRole) {
  return roleAtLeast(role, "manager");
}

export function roleLabel(role: AppRole) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}
