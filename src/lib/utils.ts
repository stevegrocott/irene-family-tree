/**
 * Safely parses a JSON string or passes through an existing object.
 * @param val - Raw value from the database or API (string, object, null, or undefined)
 * @returns Parsed key-value object, or null if the value is absent or unparseable
 */
export function safeParseJson(val: unknown): Record<string, unknown> | null {
  if (val === null || val === undefined) return null
  if (typeof val === 'object') return val as Record<string, unknown>
  try { return JSON.parse(val as string) } catch { return null }
}
