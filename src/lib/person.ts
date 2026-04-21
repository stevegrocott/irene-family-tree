export function sexDotClass(sex: string): string {
  if (sex === 'M') return 'bg-indigo-400'
  if (sex === 'F') return 'bg-rose-400'
  return 'bg-gray-400'
}

export function formatLifespan(r: { birthYear?: string | null; deathYear?: string | null }): string {
  const b = r.birthYear ?? ''
  const d = r.deathYear ?? ''
  if (b && d) return `${b}–${d}`
  if (b) return `b. ${b}`
  if (d) return `d. ${d}`
  return ''
}
