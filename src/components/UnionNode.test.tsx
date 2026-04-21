import { renderToStaticMarkup } from 'react-dom/server'
import UnionNode from './UnionNode'

jest.mock('reactflow', () => ({
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom' },
}))

function render(props: { marriageYear?: string | null; marriagePlace?: string | null } = {}) {
  return renderToStaticMarkup(
    <UnionNode marriageYear={props.marriageYear ?? null} marriagePlace={props.marriagePlace ?? null} {...({} as never)} />
  )
}

describe('UnionNode tooltip', () => {
  it('renders tooltip containing marriageYear and marriagePlace when both are provided', () => {
    const html = render({ marriageYear: '1920', marriagePlace: 'Sheffield' })
    expect(html).toContain('1920')
    expect(html).toContain('Sheffield')
  })

  it('renders no tooltip when marriageYear is null', () => {
    const html = render({ marriageYear: null })
    expect(html).not.toContain('title')
    expect(html).not.toContain('tooltip')
  })
})
