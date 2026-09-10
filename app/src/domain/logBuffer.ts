import type { TaskOutputLine } from './types'

/// A dispatched agent can stream for hours. Both bounds below exist so that a
/// chatty — or broken — child process cannot grow the webview heap without
/// limit and take the whole window down with it.

/// Lines kept in memory per task. The log file on disk stays the full record;
/// this is only the tail the UI can show.
export const TASK_LINE_CAP = 5000

/// Task logs read eagerly when a workspace loads. The rest are fetched when
/// the task is selected: bounded per task is not enough when a workspace has
/// hundreds of tasks and every pause/resume re-read all of them.
export const MAX_PRELOADED_LOGS = 8

/// Longest single line kept. A minified bundle, a base64 blob or a progress bar
/// redrawing without a newline all arrive as one enormous "line".
export const LOG_LINE_TEXT_CAP = 8 * 1024

export function clampLineText(text: string): string {
  if (text.length <= LOG_LINE_TEXT_CAP) return text
  let cut = LOG_LINE_TEXT_CAP
  // Do not cut between the halves of a surrogate pair: slicing mid-pair leaves
  // an unpaired surrogate in React state, which renders as a broken glyph.
  const code = text.charCodeAt(cut - 1)
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1
  const dropped = text.length - cut
  return `${text.slice(0, cut)}… [truncated ${dropped} chars]`
}

/// Append one line, keeping at most TASK_LINE_CAP lines and dropping from the
/// front. Returns a new array (React state stays immutable) but copies at most
/// TASK_LINE_CAP entries, so per-line cost is bounded rather than O(n).
export function appendTaskLine(
  lines: TaskOutputLine[],
  line: TaskOutputLine,
): TaskOutputLine[] {
  const clamped: TaskOutputLine =
    line.text.length <= LOG_LINE_TEXT_CAP
      ? line
      : { ...line, text: clampLineText(line.text) }
  if (lines.length < TASK_LINE_CAP) return [...lines, clamped]
  return [...lines.slice(lines.length - TASK_LINE_CAP + 1), clamped]
}

/// Same bounds, applied to a batch read back from the log file on disk.
export function capTaskLines(lines: TaskOutputLine[]): TaskOutputLine[] {
  const tail = lines.length > TASK_LINE_CAP ? lines.slice(-TASK_LINE_CAP) : lines
  return tail.map((l) =>
    l.text.length <= LOG_LINE_TEXT_CAP ? l : { ...l, text: clampLineText(l.text) },
  )
}

/// Characters the terminal pane will join into one string. The pane re-joins on
/// every render, so this bound — not TASK_LINE_CAP alone — is what keeps a
/// render cheap when every retained line is at the 8 KiB cap.
export const RENDER_BYTE_BUDGET = 256 * 1024

export function renderLogText(lines: TaskOutputLine[]): string {
  const parts: string[] = []
  let budget = RENDER_BYTE_BUDGET
  let dropped = 0
  // Walk backwards: a terminal shows the newest output.
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const piece = `${lines[i].stream}: ${lines[i].text}`
    if (piece.length > budget) {
      dropped = i + 1
      break
    }
    parts.push(piece)
    budget -= piece.length + 1
  }
  parts.reverse()
  const body = parts.join('\n')
  return dropped > 0
    ? `[${dropped} earlier output lines not shown — full log is on disk]\n${body}`
    : body
}
