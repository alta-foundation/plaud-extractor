import type { PlaudTranscript, PlaudRecording } from '../client/types.js'

export function toPlainText(transcript: PlaudTranscript): string {
  return transcript.segments
    .map(seg => {
      const speaker = seg.speaker ? `${seg.speaker}: ` : ''
      return `${speaker}${seg.text}`
    })
    .join('\n\n')
}

export function toMarkdown(transcript: PlaudTranscript, recording: PlaudRecording): string {
  const lines: string[] = []

  // YAML frontmatter
  lines.push('---')
  lines.push('source: plaud')
  lines.push(`id: "${recording.id}"`)
  lines.push(`recorded_at: "${recording.recordedAt}"`)
  if (recording.title) lines.push(`title: "${recording.title.replace(/"/g, '\\"')}"`)
  if (recording.language) lines.push(`language: "${recording.language}"`)
  lines.push(`duration_seconds: ${recording.duration}`)
  if (recording.tags?.length) lines.push(`tags: [${recording.tags.map(t => `"${t}"`).join(', ')}]`)
  lines.push('---')
  lines.push('')

  // Title
  lines.push(`# ${recording.title ?? 'Untitled Recording'}`)
  lines.push('')

  // Metadata block
  lines.push(`**Recorded:** ${formatDate(recording.recordedAt)}`)
  lines.push(`**Duration:** ${formatDuration(recording.duration)}`)
  if (recording.language) lines.push(`**Language:** ${recording.language}`)
  lines.push('')
  lines.push('## Transcript')
  lines.push('')

  // Segments
  const hasTimestamps = transcript.segments.some(s => s.startMs > 0 || s.endMs > 0)

  for (const seg of transcript.segments) {
    if (hasTimestamps) {
      const ts = `\`[${msToTimestamp(seg.startMs)}]\``
      const speaker = seg.speaker ? ` **${seg.speaker}**` : ''
      lines.push(`${ts}${speaker}`)
    } else if (seg.speaker) {
      lines.push(`**${seg.speaker}**`)
    }
    lines.push(seg.text)
    lines.push('')
  }

  return lines.join('\n')
}

function msToTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    })
  } catch {
    return iso
  }
}
