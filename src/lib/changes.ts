import { randomUUID } from 'crypto'
import { write } from '@/lib/neo4j'

export async function recordChange(
  authorEmail: string,
  authorName: string,
  changeType: string,
  targetId: string,
  previousValue: object | null,
  newValue: object
): Promise<void> {
  await write(
    `CREATE (c:Change {
      id: $id,
      status: 'live',
      appliedAt: $appliedAt,
      authorEmail: $authorEmail,
      authorName: $authorName,
      changeType: $changeType,
      targetId: $targetId,
      previousValue: $previousValue,
      newValue: $newValue
    })`,
    {
      id: randomUUID(),
      appliedAt: new Date().toISOString(),
      authorEmail,
      authorName,
      changeType,
      targetId,
      previousValue: previousValue !== null ? JSON.stringify(previousValue) : null,
      newValue: JSON.stringify(newValue),
    }
  )
}
