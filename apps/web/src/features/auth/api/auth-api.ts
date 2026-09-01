import type { AuthResponse, LoginInput, RegisterInput } from '@/features/auth/model/types';
import { apiRequest } from '@/shared/api/client';

export function register(input: RegisterInput): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/auth/register', {
    method: 'POST',
    body: input,
  });
}

export function login(input: LoginInput): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/auth/login', {
    method: 'POST',
    body: input,
  });
}

export function getCurrentUser(): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/auth/me');
}

export function logout(): Promise<void> {
  return apiRequest<void>('/auth/logout', {
    method: 'POST',
  });
}
