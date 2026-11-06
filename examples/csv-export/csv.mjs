// Teaching fixture: escapeCell intentionally contains a CSV quoting bug.
export function toCsv(rows, selectedIds) {
  const selected = new Set(selectedIds)
  const values = [['id', 'name', 'note'], ...rows
    .filter((row) => selected.has(row.id))
    .map((row) => [row.id, row.name, row.note])]
  return values.map((row) => row.map(escapeCell).join(',')).join('\r\n') + '\r\n'
}

function escapeCell(value) {
  return String(value) // DEMO: intentionally unescaped
}
