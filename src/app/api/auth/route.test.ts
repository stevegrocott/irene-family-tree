import * as routeModule from './[...nextauth]/route'

describe('auth route handler', () => {
  it('exports a GET handler', () => {
    expect(typeof routeModule.GET).toBe('function')
  })

  it('exports a POST handler', () => {
    expect(typeof routeModule.POST).toBe('function')
  })
})
