import { timeMinutes } from "./roster-dates"

// Clip breaks to working hours, subtracting overlapping breaks only once.
export function workingSegments(slot: { startTime: string; endTime: string; breaks?: { startTime: string; endTime: string }[] }) {
  const segments: { start: number; end: number }[] = []
  let cursor = timeMinutes(slot.startTime)
  const end = timeMinutes(slot.endTime)
  for (const pause of [...(slot.breaks ?? [])].sort((a, b) => timeMinutes(a.startTime) - timeMinutes(b.startTime))) {
    const start = Math.max(cursor, Math.min(end, timeMinutes(pause.startTime)))
    if (start > cursor) segments.push({ start: cursor, end: start })
    cursor = Math.max(cursor, Math.min(end, timeMinutes(pause.endTime)))
  }
  if (cursor < end) segments.push({ start: cursor, end })
  return segments
}
