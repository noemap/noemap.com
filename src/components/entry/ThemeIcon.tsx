const drawings: Record<string, string> = {
  activity: "M3 12h4l3-8 4 16 3-8h4",
  brain:
    "M12 5c-1-3-5-2-5 1-4 0-5 5-2 7-2 3 0 7 3 7 1 3 4 2 4-1V5m0 0c1-3 5-2 5 1 4 0 5 5 2 7 2 3 0 7-3 7-1 3-4 2-4-1M7 9l2 2m8-2-2 2M7 16l2-2m8 2-2-2",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-4M13 3a4 4 0 0 1 0 8M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8",
  landmark: "M3 10h18M4 10V8l8-5 8 5v2M6 10v9m6-9v9m6-9v9M3 21h18",
  scale: "M12 3v18m-5 0h10M3 7l9-3 9 3M3 7l-2 7h6L3 7m18 0-3 7h6l-3-7",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5",
  hourglass: "M6 3h12M6 21h12M7 3v4l10 10v4M17 3v4L7 17v4",
  compass: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m4 6-3 5-5 3 3-5 5-3",
};
export function ThemeIcon({ name }: { name: string }) {
  return (
    <svg
      width="30"
      height="30"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={drawings[name] ?? drawings.compass} />
    </svg>
  );
}
