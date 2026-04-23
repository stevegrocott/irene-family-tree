export const GEDCOM_TYPES = {
  INDIVIDUAL: 'INDI',
  FAMILY: 'FAM',
  NAME: 'NAME',
  GIVEN_NAME: 'GIVN',
  SURNAME: 'SURN',
  SEX: 'SEX',
  BIRTH: 'BIRT',
  DEATH: 'DEAT',
  DATE: 'DATE',
  PLACE: 'PLAC',
  OCCUPATION: 'OCCU',
  NOTE: 'NOTE',
  MARRIAGE: 'MARR',
  HEAD: 'HEAD',
  GEDC: 'GEDC',
  VERS: 'VERS',
  FORM: 'FORM',
  CHAR: 'CHAR',
  SOUR: 'SOUR',
  HUSB: 'HUSB',
  WIFE: 'WIFE',
  CHIL: 'CHIL',
  FAMS: 'FAMS',
  FAMC: 'FAMC',
  CONT: 'CONT',
  TRLR: 'TRLR',
} as const

export function escapeGedcomValue(value: string): string {
  return value.replace(/@/g, '@@')
}

export function extractYear(dateString: string): string | null {
  return dateString.match(/\d{4}/)?.[0] ?? null
}

export function buildNoteLines(level: number, notes: string): string[] {
  const noteLines = notes.split('\n')
  const result = [`${level} ${GEDCOM_TYPES.NOTE} ${escapeGedcomValue(noteLines[0])}`]
  for (const cont of noteLines.slice(1)) {
    result.push(`${level + 1} ${GEDCOM_TYPES.CONT} ${escapeGedcomValue(cont)}`)
  }
  return result
}

export interface PersonNode {
  gedcomId: string
  name: string
  sex: string
  birthYear: string | null
  deathYear: string | null
  birthPlace: string | null
  deathPlace: string | null
  occupation: string | null
  notes: string | null
}

function addLifeEvent(lines: string[], tag: string, year: string | null, place: string | null): void {
  if (!year && !place) return
  lines.push(`1 ${tag}`)
  if (year) lines.push(`2 ${GEDCOM_TYPES.DATE} ${year}`)
  if (place) lines.push(`2 ${GEDCOM_TYPES.PLACE} ${escapeGedcomValue(place)}`)
}

export function buildIndiRecord(person: PersonNode, famsIds: string[], famcIds: string[]): string {
  const lines: string[] = []

  lines.push(`0 ${person.gedcomId} ${GEDCOM_TYPES.INDIVIDUAL}`)

  if (!person.name || person.name === '[Unknown]') {
    lines.push(`1 ${GEDCOM_TYPES.NAME} [Unknown]`)
  } else {
    const parts = person.name.trim().split(' ')
    const surname = parts.length > 1 ? parts[parts.length - 1] : ''
    const givenName = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0]
    const gedcomName = surname
      ? `${escapeGedcomValue(givenName)} /${escapeGedcomValue(surname)}/`
      : escapeGedcomValue(givenName)
    lines.push(`1 ${GEDCOM_TYPES.NAME} ${gedcomName}`)
    if (givenName) lines.push(`2 ${GEDCOM_TYPES.GIVEN_NAME} ${escapeGedcomValue(givenName)}`)
    if (surname) lines.push(`2 ${GEDCOM_TYPES.SURNAME} ${escapeGedcomValue(surname)}`)
  }

  if (person.sex) {
    lines.push(`1 ${GEDCOM_TYPES.SEX} ${person.sex}`)
  }

  addLifeEvent(lines, GEDCOM_TYPES.BIRTH, person.birthYear, person.birthPlace)
  addLifeEvent(lines, GEDCOM_TYPES.DEATH, person.deathYear, person.deathPlace)

  if (person.occupation) {
    lines.push(`1 ${GEDCOM_TYPES.OCCUPATION} ${escapeGedcomValue(person.occupation)}`)
  }

  if (person.notes) {
    lines.push(...buildNoteLines(1, person.notes))
  }

  for (const uid of famsIds) {
    lines.push(`1 ${GEDCOM_TYPES.FAMS} ${uid}`)
  }
  for (const uid of famcIds) {
    lines.push(`1 ${GEDCOM_TYPES.FAMC} ${uid}`)
  }

  return lines.join('\n')
}
