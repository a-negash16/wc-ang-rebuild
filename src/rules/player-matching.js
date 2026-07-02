const DIACRITIC_MARKS = /[\u0300-\u036f]/g;

export function normalizePlayerName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(DIACRITIC_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

export function playerNamesMatch(a, b) {
  const normalizedA = normalizePlayerName(a);
  const normalizedB = normalizePlayerName(b);
  return Boolean(normalizedA) && normalizedA === normalizedB;
}
