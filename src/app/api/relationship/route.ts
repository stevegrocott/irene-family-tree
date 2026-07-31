/**
 * @module api/relationship
 * @description Public Next.js App Router route handler that computes the shortest
 * kinship path between two people in the family graph and a human-readable label
 * describing how they are related (e.g. "first cousin once removed").
 */

import { read, neo4jErrorResponse } from '@/lib/neo4j'
import { computeKinshipLabel, type KinshipStep, type Sex } from '@/lib/kinship'

/** Force Node.js runtime so the Neo4j driver can open TCP connections. */
export const runtime = 'nodejs'

/** Hard cap on the number of `UNION`/`CHILD` relationship hops the shortest-path search may traverse. */
const MAX_RELATIONSHIP_HOPS = 20

/**
 * Raw shape of a graph node on the shortest path, as returned by the Neo4j query.
 * Path nodes alternate `Person`, `Union`, `Person`, ... between the two endpoints.
 *
 * @interface Neo4jPathNode
 */
interface Neo4jPathNode {
  _id: string
  _labels: string[]
  gedcomId: string
  name?: string
  sex?: string | null
}

/**
 * Raw shape of a graph relationship on the shortest path.
 * `start`/`end` are element IDs corresponding to {@link Neo4jPathNode._id}, reflecting
 * the relationship's true stored direction (not the direction it was traversed in).
 *
 * @interface Neo4jPathRel
 */
interface Neo4jPathRel {
  type: string
  start: string
  end: string
}

/** Row shape returned by the shortest-path Cypher query. */
interface RelationshipPathRow {
  fromExists: boolean
  toExists: boolean
  nodes: Neo4jPathNode[] | null
  rels: Neo4jPathRel[] | null
}

/** Response payload for `GET /api/relationship`. */
interface RelationshipResponse {
  from: string
  to: string
  steps: KinshipStep[]
  label: string
}

/**
 * Error thrown when a path's relationship structure does not match any known
 * `UNION`/`CHILD` pattern. Should be unreachable given the graph model, but guards
 * against silently mislabeling a step if the schema ever changes.
 */
class UnclassifiableStepError extends Error {}

/**
 * Classifies a single Union crossing between two adjacent Person nodes on the path
 * into one or more {@link KinshipStep}s.
 *
 * The family graph models a union as `(Person)-[:UNION]->(Union)` (partner in the
 * union) and `(Union)-[:CHILD]->(Person)` (child born of the union). A shortest path
 * walks `Person -> Union -> Person` for each step, so the pair of relationships either
 * side of the Union node determines the relation:
 * - prev is a partner in the union, next is a child of it  -> next is prev's `child`
 * - prev is a child of the union, next is a partner in it  -> next is prev's `parent`
 * - both prev and next are partners in the same union      -> next is prev's `spouse`
 * - both prev and next are children of the same union      -> next is prev's sibling,
 *   expressed as a `parent` hop up to the shared union followed by a `child` hop down
 *   to `next`, since the {@link KinshipStep} vocabulary has no dedicated sibling type
 */
function classifyStep(
  prev: Neo4jPathNode,
  union: Neo4jPathNode,
  next: Neo4jPathNode,
  prevRel: Neo4jPathRel,
  nextRel: Neo4jPathRel
): KinshipStep[] {
  const prevIsPartner = prevRel.type === 'UNION' && prevRel.start === prev._id && prevRel.end === union._id
  const prevIsChild = prevRel.type === 'CHILD' && prevRel.start === union._id && prevRel.end === prev._id
  const nextIsPartner = nextRel.type === 'UNION' && nextRel.start === next._id && nextRel.end === union._id
  const nextIsChild = nextRel.type === 'CHILD' && nextRel.start === union._id && nextRel.end === next._id

  const name = next.name ?? ''
  const sex = (next.sex ?? null) as Sex

  if (prevIsPartner && nextIsChild) {
    return [{ type: 'child', name, sex }]
  }
  if (prevIsChild && nextIsPartner) {
    return [{ type: 'parent', name, sex }]
  }
  if (prevIsPartner && nextIsPartner) {
    return [{ type: 'spouse', name, sex }]
  }
  if (prevIsChild && nextIsChild) {
    return [{ type: 'parent' }, { type: 'child', name, sex }]
  }
  throw new UnclassifiableStepError(
    `Cannot classify step through union ${union.gedcomId}: ${prevRel.type} then ${nextRel.type}`
  )
}

/**
 * Walks a shortest path's alternating `Person, Union, Person, ...` node sequence and
 * classifies each Union crossing into a {@link KinshipStep}.
 */
function classifySteps(nodes: Neo4jPathNode[], rels: Neo4jPathRel[]): KinshipStep[] {
  const steps: KinshipStep[] = []
  for (let i = 0; i + 2 < nodes.length; i += 2) {
    steps.push(...classifyStep(nodes[i], nodes[i + 1], nodes[i + 2], rels[i], rels[i + 1]))
  }
  return steps
}

/**
 * Returns the shortest kinship path between two people and a human-readable label
 * describing how they are related.
 *
 * Query Parameters:
 * - `from` (required): GEDCOM ID of the first person
 * - `to` (required): GEDCOM ID of the second person
 *
 * @async
 * @param {Request} request - Incoming HTTP request; `from` and `to` query params identify the two people
 * @returns {Promise<Response>} JSON `RelationshipResponse` on success, or error JSON with 400/404/500 status
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')

  if (!from || !to) {
    return Response.json({ error: 'from and to query parameters are required' }, { status: 400 })
  }

  if (from === to) {
    let existsRows: { exists: boolean }[]
    try {
      existsRows = await read<{ exists: boolean }>(
        `OPTIONAL MATCH (a:Person {gedcomId: $from}) RETURN a IS NOT NULL AS exists`,
        { from }
      )
    } catch (err) {
      return neo4jErrorResponse(err, 'Failed to query graph database')
    }

    if (!existsRows[0]?.exists) {
      return Response.json({ error: 'Person not found' }, { status: 404 })
    }

    return Response.json({
      from,
      to,
      steps: [],
      label: computeKinshipLabel([]),
    } satisfies RelationshipResponse)
  }

  let rows: RelationshipPathRow[]
  try {
    rows = await read<RelationshipPathRow>(
      `OPTIONAL MATCH (a:Person {gedcomId: $from})
       OPTIONAL MATCH (b:Person {gedcomId: $to})
       CALL {
         WITH a, b
         WITH a, b WHERE a IS NOT NULL AND b IS NOT NULL
         OPTIONAL MATCH p = shortestPath((a)-[:UNION|CHILD*..${MAX_RELATIONSHIP_HOPS}]-(b))
         RETURN p
       }
       RETURN
         a IS NOT NULL AS fromExists,
         b IS NOT NULL AS toExists,
         CASE WHEN p IS NULL THEN null ELSE
           [n IN nodes(p) | {_id: elementId(n), _labels: labels(n), gedcomId: n.gedcomId, name: n.name, sex: n.sex}]
         END AS nodes,
         CASE WHEN p IS NULL THEN null ELSE
           [r IN relationships(p) | {type: type(r), start: elementId(startNode(r)), end: elementId(endNode(r))}]
         END AS rels`,
      { from, to }
    )
  } catch (err) {
    return neo4jErrorResponse(err, 'Failed to query graph database')
  }

  const row = rows[0]

  if (!row?.fromExists || !row?.toExists) {
    return Response.json({ error: 'Person not found' }, { status: 404 })
  }

  if (!row.nodes || !row.rels) {
    return Response.json(
      { error: `No relationship path found within ${MAX_RELATIONSHIP_HOPS} hops` },
      { status: 404 }
    )
  }

  let steps: KinshipStep[]
  try {
    steps = classifySteps(row.nodes, row.rels)
  } catch (err) {
    return neo4jErrorResponse(err, 'Failed to classify relationship path')
  }

  return Response.json({
    from,
    to,
    steps,
    label: computeKinshipLabel(steps),
  } satisfies RelationshipResponse)
}
