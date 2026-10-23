export function csvCell(value: unknown) {
  const string = value == null ? "" : String(value);
  // Submitted names and addresses must not execute as spreadsheet formulas.
  const safe = /^[\s]*[=+@\-\t\r\n]/.test(string) ? `'${string}` : string;
  return `"${safe.replace(/"/g, '""')}"`;
}
