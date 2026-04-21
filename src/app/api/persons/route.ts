import { listPersons } from '@/lib/dataset'

export function GET() {
  return Response.json(listPersons())
}
