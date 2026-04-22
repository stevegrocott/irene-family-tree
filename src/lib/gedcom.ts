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
