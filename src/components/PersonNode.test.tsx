import { renderToStaticMarkup } from 'react-dom/server'
import PersonNode from './PersonNode'
import type { PersonData } from '@/types/tree'

jest.mock('reactflow', () => ({
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom' },
}))

const baseData: PersonData = {
  gedcomId: '@I85@',
  name: 'Irene Tunnicliffe',
  sex: 'U',
  birthYear: null,
  deathYear: null,
  birthPlace: null,
  deathPlace: null,
  occupation: null,
  notes: null,
}

function render(overrides: Partial<PersonData> = {}) {
  return renderToStaticMarkup(
    <PersonNode data={{ ...baseData, ...overrides }} {...({} as never)} />
  )
}

describe('PersonNode avatar', () => {
  it('renders initials "IT" for "Irene Tunnicliffe"', () => {
    const html = render({ name: 'Irene Tunnicliffe' })
    expect(html).toContain('>IT<')
  })

  it('applies bg-indigo-900/40 when generation is -1', () => {
    const html = render({ generation: -1 })
    expect(html).toContain('bg-indigo-900/40')
  })

  it('applies bg-emerald-900/40 when generation is 1', () => {
    const html = render({ generation: 1 })
    expect(html).toContain('bg-emerald-900/40')
  })

  it('applies neither bg-indigo-900/40 nor bg-emerald-900/40 when generation is 0', () => {
    const html = render({ generation: 0 })
    expect(html).not.toContain('bg-indigo-900/40')
    expect(html).not.toContain('bg-emerald-900/40')
  })
})
