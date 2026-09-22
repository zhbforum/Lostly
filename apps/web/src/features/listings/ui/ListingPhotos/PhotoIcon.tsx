const paths = {
  image: 'M4 4h16v16H4z M4 15l5-5 5 5 3-3 3 3 M15 8h.01',
  add: 'M12 5v14 M5 12h14',
  left: 'M14 6l-6 6 6 6',
  right: 'M10 6l6 6-6 6',
  check: 'M5 12l4 4L19 6',
  remove: 'M8 8l8 8 M16 8l-8 8',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v5 M14 11v5',
} as const;

export function PhotoIcon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}
