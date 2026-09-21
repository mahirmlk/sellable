// Browser-only CSV download. No backend involved: callers pass plain row
// objects and get a `filename.csv` download via a Blob object URL.

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  // Quote when the cell contains a comma, quote, or line break (RFC 4180).
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function exportToCsv(
  filename: string,
  rows: Record<string, unknown>[]
): void {
  const safeName = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  const headers: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!headers.includes(key)) headers.push(key);
    }
  }
  const lines = [
    headers.map(escapeCell).join(","),
    ...rows.map((row) =>
      headers.map((h) => escapeCell(row[h])).join(",")
    ),
  ];
  const blob = new Blob([lines.join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = safeName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke after the click so the download has a chance to start.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
