export function formatListingDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);

  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}
