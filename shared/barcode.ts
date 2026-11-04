/** Prüft EAN-13 / UPC-A (12 Stellen) / EAN-8 anhand der Prüfziffer */
export function validBarcode(code: string): boolean {
  const d = code.replace(/\D/g, "");
  if (![8, 12, 13].includes(d.length)) return false;
  const digits = d.split("").map(Number);
  const check = digits.pop()!;
  // Von rechts: abwechselnd Gewicht 3 und 1
  const sum = digits.reverse().reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}
