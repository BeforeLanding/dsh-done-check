import assert from 'node:assert/strict'
import { toCsv } from './csv.mjs'

const checks = {
  rows() {
    const rows = [
      { id: 1, name: 'Ada', note: 'not selected' },
      { id: 2, name: 'Mei', note: 'selected' },
      { id: 3, name: 'Lin', note: 'not selected' },
    ]
    assert.equal(toCsv(rows, [2]), 'id,name,note\r\n2,Mei,selected\r\n',
      'The CSV must contain exactly the selected row and its fields')
  },
  escaping() {
    const rows = [{ id: 1, name: '张三', note: 'hello, "world"\nnext line' }]
    assert.equal(toCsv(rows, [1]),
      'id,name,note\r\n1,张三,"hello, ""world""\nnext line"\r\n',
      'Commas, double quotes and newlines must remain inside one CSV field')
  },
}

const requested = process.argv[2]
if (requested && !Object.hasOwn(checks, requested)) {
  console.error('Usage: node test.mjs [rows|escaping]')
  process.exit(2)
}
for (const name of requested ? [requested] : Object.keys(checks)) {
  checks[name]()
  console.log(`PASS ${name}`)
}
