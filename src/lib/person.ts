import type { PersonData, Relative } from '@/types/tree'

export const sexDotClass = (sex: string | null | undefined): string =>
  sex === 'M' ? 'bg-sky-400' : sex === 'F' ? 'bg-pink-400' : 'bg-slate-400'

export const formatLifespan = (
  r: Pick<Relative, 'birthYear' | 'deathYear'> | Pick<PersonData, 'birthYear' | 'deathYear'>,
): string => [r.birthYear, r.deathYear].filter(Boolean).join('–')
