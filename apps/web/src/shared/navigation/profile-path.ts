export function profilePath(profile: { id: string; username?: string | null }) {
  return profile.username
    ? `/u/${encodeURIComponent(profile.username)}`
    : `/users/${encodeURIComponent(profile.id)}`;
}
