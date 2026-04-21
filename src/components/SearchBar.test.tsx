/**
 * @jest-environment jsdom
 */

// Required for React act() to work correctly in tests
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import SearchBar from './SearchBar'

interface Person {
  gedcomId: string
  name: string
  sex: string | null
  birthYear: string | null
  birthPlace: string | null
}

const persons: Person[] = [
  { gedcomId: '@I1@', name: 'Alice Brown',   birthPlace: 'Sheffield', birthYear: null, sex: 'F' },
  { gedcomId: '@I2@', name: 'Bob Green',     birthYear: '1920',       birthPlace: null, sex: 'M' },
  { gedcomId: '@I3@', name: 'Charlie White', birthYear: null,         birthPlace: null, sex: 'U' },
]

// Simulate typing into a controlled React input
async function typeQuery(input: HTMLInputElement, value: string) {
  await act(async () => {
    const nativeValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!
    nativeValueSetter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('SearchBar', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  const onSelect = jest.fn()

  beforeEach(async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    await act(async () => {
      root = createRoot(container)
      root.render(
        <SearchBar
          onSelect={onSelect}
          persons={persons}
        />,
      )
    })
  })

  afterEach(() => {
    act(() => { root.unmount() })
    document.body.removeChild(container)
    jest.clearAllMocks()
  })

  it('place search for "Sheffield" returns the Sheffield person', async () => {
    const input = container.querySelector('input')!
    await typeQuery(input, 'Sheffield')
    const list = container.querySelector('.search-results')
    expect(list).not.toBeNull()
    expect(list!.textContent).toContain('Alice Brown')
    expect(list!.textContent).not.toContain('Bob Green')
    expect(list!.textContent).not.toContain('Charlie White')
  })

  it('year search for "1920" returns the 1920 person', async () => {
    const input = container.querySelector('input')!
    await typeQuery(input, '1920')
    const list = container.querySelector('.search-results')
    expect(list).not.toBeNull()
    expect(list!.textContent).toContain('Bob Green')
    expect(list!.textContent).not.toContain('Alice Brown')
    expect(list!.textContent).not.toContain('Charlie White')
  })

  it('result item contains a sex dot element', async () => {
    const input = container.querySelector('input')!
    await typeQuery(input, 'Alice')
    const item = container.querySelector('.search-results li')
    expect(item).not.toBeNull()
    expect(item!.querySelector('.sex-dot')).not.toBeNull()
  })

  it('name-only search for "Charlie" returns Charlie White', async () => {
    const input = container.querySelector('input')!
    await typeQuery(input, 'Charlie')
    const list = container.querySelector('.search-results')
    expect(list).not.toBeNull()
    expect(list!.textContent).toContain('Charlie White')
    expect(list!.textContent).not.toContain('Alice Brown')
    expect(list!.textContent).not.toContain('Bob Green')
  })
})
