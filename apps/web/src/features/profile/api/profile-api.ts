import type {
  ProfileResponse,
  PublicProfileResponse,
  UpdateProfileInput,
  UsernameAvailability,
} from '@lostly/contracts/profile';
import { apiRequest } from '@/shared/api/client';

export const getPublicProfile = (
  id: string,
  signal?: AbortSignal,
  lookup: 'id' | 'username' = 'id',
) =>
  apiRequest<PublicProfileResponse>(
    `/${lookup === 'username' ? 'u' : 'users'}/${encodeURIComponent(id)}`,
    { signal },
  );

export const checkUsername = (username: string, signal?: AbortSignal) =>
  apiRequest<UsernameAvailability>(`/me/profile/username/${encodeURIComponent(username)}`, {
    signal,
  });

export const getProfile = (signal?: AbortSignal) =>
  apiRequest<ProfileResponse>('/me/profile', { signal });
export const saveProfile = (body: UpdateProfileInput, signal?: AbortSignal) =>
  apiRequest<ProfileResponse>('/me/profile', { method: 'PATCH', body, signal });

export function uploadAvatar(file: File, expectedVersion: number, signal?: AbortSignal) {
  const body = new FormData();
  body.append('file', file);
  body.append('expectedVersion', String(expectedVersion));
  return apiRequest<ProfileResponse>('/me/profile/avatar', { method: 'POST', body, signal });
}

export const removeAvatar = (expectedVersion: number, signal?: AbortSignal) =>
  apiRequest<ProfileResponse>('/me/profile/avatar', {
    method: 'DELETE',
    body: { expectedVersion },
    signal,
  });
