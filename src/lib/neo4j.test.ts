import { describe, it, expect, afterAll } from 'vitest'
import { driver, read } from './neo4j'

describe('neo4j connection', () => {
  afterAll(async () => {
    await driver.close()
  })

  it('runs RETURN 1 AS n and returns 1', async () => {
    const rows = await read<{ n: number }>('RETURN 1 AS n')
    expect(rows[0].n).toBe(1)
  })
})
