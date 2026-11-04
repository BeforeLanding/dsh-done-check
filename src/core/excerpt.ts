/**
 * Picks a few lines of a failed check's own output to show the user. It
 * quotes, never interprets: the lines are labelled "测试报告" in the UI and
 * the plugin draws no conclusion from them.
 */

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g
/** Runtime chatter that says nothing about the check. */
const NOISE = [
  /^\(node:\d+\)/,
  /^\(Use `node --trace-/,
  /Warning: The 'NO_COLOR' env is ignored/,
  /ExperimentalWarning/,
  /^npm warn/i,
]
const MAX_LINES = 3
const MAX_LINE_CHARS = 200

export function stripAnsi(text: string): string {
  return text.replaceAll(ANSI, '').replaceAll('\r\n', '\n').replaceAll('\r', '\n')
}

function meaningful(text: string): string[] {
  return stripAnsi(text)
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() && !NOISE.some((re) => re.test(l.trim())))
}

/** The last three meaningful lines of stderr (stdout when stderr has none); empty when there are none. */
export function failureExcerpt(stdout: string, stderr: string): string[] {
  const err = meaningful(stderr)
  const lines = err.length ? err : meaningful(stdout)
  return lines.slice(-MAX_LINES).map((l) => {
    const t = l.trim()
    return t.length > MAX_LINE_CHARS ? `${t.slice(0, MAX_LINE_CHARS)}…` : t
  })
}
