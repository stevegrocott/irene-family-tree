export function neo4jErrorResponseMock() {
  return {
    neo4jErrorResponse: jest.fn((err: unknown, publicMessage: string, status = 500) => {
      const detail = err instanceof Error ? err.message : String(err)
      return Response.json({ error: publicMessage, detail }, { status })
    }),
  }
}
