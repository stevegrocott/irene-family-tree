/** Breakdown of persons by recorded biological sex. */
export interface SexBreakdown {
  male: number
  female: number
  unknown: number
}

/** Number of births recorded in a given decade (e.g. `1950` covers 1950-1959). */
export interface DecadeCount {
  decade: number
  count: number
}

/** Number of persons sharing a derived surname. */
export interface SurnameCount {
  surname: string
  count: number
}

/** Number of persons sharing a recorded birthplace. */
export interface BirthplaceCount {
  birthPlace: string
  count: number
}

/** The earliest-born person with a known birth year. */
export interface OldestAncestor {
  gedcomId: string
  name: string
  birthYear: string
}

/** The union (marriage/partnership) with the most recorded children. */
export interface LargestUnion {
  unionId: string
  childCount: number
  parents: string[]
}

/** Aggregate statistics payload returned by `GET /api/stats`. */
export interface StatsResponse {
  totalPeople: number
  sexBreakdown: SexBreakdown
  unionCount: number
  birthsByDecade: DecadeCount[]
  topSurnames: SurnameCount[]
  topBirthplaces: BirthplaceCount[]
  averageLifespan: number | null
  oldestAncestor: OldestAncestor | null
  largestUnion: LargestUnion | null
}
