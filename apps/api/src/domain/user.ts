export const USER_ROLES = ['user', 'admin'] as const;

export type userRole = (typeof USER_ROLES)[number];
