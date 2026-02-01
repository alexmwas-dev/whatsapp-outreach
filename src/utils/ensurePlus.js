export function ensurePlus(phone) {
  const clean = phone.replace(/[^0-9+]/g, "");
  return clean.startsWith("+") ? clean : "+" + clean;
}
