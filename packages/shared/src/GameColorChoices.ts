/**
 * Free, selectable territory colors from the standard game's human palette.
 * Deliberately finite and shared by client + lobby server: a client cannot
 * request an arbitrary premium color through the join packet.
 * Team matches continue to use the team's assigned color.
 */
export const GAME_COLOR_CHOICES = [
  { color: "#a3e635", label: "Lima" },
  { color: "#22c55e", label: "Verde" },
  { color: "#10b981", label: "Esmeralda" },
  { color: "#2dd4bf", label: "Turquesa" },
  { color: "#06b6d4", label: "Cian" },
  { color: "#38bdf8", label: "Celeste" },
  { color: "#3b82f6", label: "Azul" },
  { color: "#4f46e5", label: "Índigo" },
  { color: "#9333ea", label: "Violeta" },
  { color: "#d946ef", label: "Magenta" },
  { color: "#ec4899", label: "Rosa" },
  { color: "#ef4444", label: "Rojo" },
  { color: "#fb7185", label: "Coral" },
  { color: "#f97316", label: "Naranja" },
  { color: "#fbbf24", label: "Ámbar" },
  { color: "#eab308", label: "Amarillo" },
  { color: "#93c5fd", label: "Hielo" },
  { color: "#c084fc", label: "Lavanda" },
  { color: "#52b788", label: "Salvia" },
  { color: "#fcd34d", label: "Dorado" },
] as const;

/** Normalized hex, or null for unknown/untrusted input. */
export function normalizeGameColorChoice(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hex = value.trim().toLowerCase();
  return GAME_COLOR_CHOICES.some((entry) => entry.color === hex) ? hex : null;
}
