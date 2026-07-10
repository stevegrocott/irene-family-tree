import { computeKinshipLabel, KinshipStep } from './kinship'

function step(type: KinshipStep['type'], sex: KinshipStep['sex'] = null): KinshipStep {
  return { type, sex }
}

describe('computeKinshipLabel — self', () => {
  it('returns "self" for an empty step sequence', () => {
    expect(computeKinshipLabel([])).toBe('self')
  })
})

describe('computeKinshipLabel — parent', () => {
  it('labels a male parent as father', () => {
    expect(computeKinshipLabel([step('parent', 'M')])).toBe('father')
  })

  it('labels a female parent as mother', () => {
    expect(computeKinshipLabel([step('parent', 'F')])).toBe('mother')
  })

  it('falls back to neutral "parent" when sex is unset', () => {
    expect(computeKinshipLabel([step('parent', null)])).toBe('parent')
  })
})

describe('computeKinshipLabel — grandparents and great-grandparents', () => {
  it('labels two parent steps as grandfather/grandmother', () => {
    expect(computeKinshipLabel([step('parent'), step('parent', 'M')])).toBe('grandfather')
    expect(computeKinshipLabel([step('parent'), step('parent', 'F')])).toBe('grandmother')
  })

  it('labels three parent steps as great-grandparent', () => {
    expect(computeKinshipLabel([step('parent'), step('parent'), step('parent', 'M')])).toBe(
      'great-grandfather'
    )
  })

  it('labels four parent steps as great-great-grandparent', () => {
    expect(
      computeKinshipLabel([step('parent'), step('parent'), step('parent'), step('parent', 'F')])
    ).toBe('great-great-grandmother')
  })

  it('falls back to neutral "grandparent" when sex is unset', () => {
    expect(computeKinshipLabel([step('parent'), step('parent', null)])).toBe('grandparent')
  })
})

describe('computeKinshipLabel — child', () => {
  it('labels a male child as son', () => {
    expect(computeKinshipLabel([step('child', 'M')])).toBe('son')
  })

  it('labels a female child as daughter', () => {
    expect(computeKinshipLabel([step('child', 'F')])).toBe('daughter')
  })

  it('falls back to neutral "child" when sex is unset', () => {
    expect(computeKinshipLabel([step('child', null)])).toBe('child')
  })
})

describe('computeKinshipLabel — grandchildren and great-grandchildren', () => {
  it('labels two child steps as grandson/granddaughter', () => {
    expect(computeKinshipLabel([step('child'), step('child', 'M')])).toBe('grandson')
    expect(computeKinshipLabel([step('child'), step('child', 'F')])).toBe('granddaughter')
  })

  it('labels three child steps as great-grandchild', () => {
    expect(computeKinshipLabel([step('child'), step('child'), step('child', 'F')])).toBe(
      'great-granddaughter'
    )
  })
})

describe('computeKinshipLabel — siblings', () => {
  it('labels an up-then-down path as brother', () => {
    expect(computeKinshipLabel([step('parent'), step('child', 'M')])).toBe('brother')
  })

  it('labels an up-then-down path as sister', () => {
    expect(computeKinshipLabel([step('parent'), step('child', 'F')])).toBe('sister')
  })

  it('falls back to neutral "sibling" when sex is unset', () => {
    expect(computeKinshipLabel([step('parent'), step('child', null)])).toBe('sibling')
  })
})

describe('computeKinshipLabel — uncle/aunt', () => {
  it('labels a grandparent-then-down path as uncle', () => {
    expect(computeKinshipLabel([step('parent'), step('parent'), step('child', 'M')])).toBe(
      'uncle'
    )
  })

  it('labels a grandparent-then-down path as aunt', () => {
    expect(computeKinshipLabel([step('parent'), step('parent'), step('child', 'F')])).toBe('aunt')
  })

  it('labels a great-grandparent-then-down path as great-uncle', () => {
    expect(
      computeKinshipLabel([step('parent'), step('parent'), step('parent'), step('child', 'M')])
    ).toBe('great-uncle')
  })

  it('labels a great-great-grandparent-then-down path as great-great-aunt', () => {
    expect(
      computeKinshipLabel([
        step('parent'),
        step('parent'),
        step('parent'),
        step('parent'),
        step('child', 'F'),
      ])
    ).toBe('great-great-aunt')
  })
})

describe('computeKinshipLabel — niece/nephew', () => {
  it('labels an up-then-two-down path as nephew', () => {
    expect(computeKinshipLabel([step('parent'), step('child'), step('child', 'M')])).toBe(
      'nephew'
    )
  })

  it('labels an up-then-two-down path as niece', () => {
    expect(computeKinshipLabel([step('parent'), step('child'), step('child', 'F')])).toBe('niece')
  })

  it('labels an up-then-three-down path as grandnephew', () => {
    expect(
      computeKinshipLabel([step('parent'), step('child'), step('child'), step('child', 'M')])
    ).toBe('grandnephew')
  })

  it('labels an up-then-four-down path as great-grandniece', () => {
    expect(
      computeKinshipLabel([
        step('parent'),
        step('child'),
        step('child'),
        step('child'),
        step('child', 'F'),
      ])
    ).toBe('great-grandniece')
  })
})

describe('computeKinshipLabel — cousins with generalized degree and removal', () => {
  it('labels a two-up-two-down path as first cousin', () => {
    expect(
      computeKinshipLabel([step('parent'), step('parent'), step('child'), step('child', 'M')])
    ).toBe('first cousin')
  })

  it('labels a two-up-three-down path as first cousin once removed', () => {
    expect(
      computeKinshipLabel([
        step('parent'),
        step('parent'),
        step('child'),
        step('child'),
        step('child', 'F'),
      ])
    ).toBe('first cousin once removed')
  })

  it('labels a three-up-four-down path as second cousin once removed', () => {
    expect(
      computeKinshipLabel([
        step('parent'),
        step('parent'),
        step('parent'),
        step('child'),
        step('child'),
        step('child'),
        step('child', 'M'),
      ])
    ).toBe('second cousin once removed')
  })

  it('labels a three-up-three-down path as second cousin', () => {
    expect(
      computeKinshipLabel([
        step('parent'),
        step('parent'),
        step('parent'),
        step('child'),
        step('child'),
        step('child', 'F'),
      ])
    ).toBe('second cousin')
  })

  it('labels a four-up-two-down path as first cousin twice removed', () => {
    expect(
      computeKinshipLabel([
        step('parent'),
        step('parent'),
        step('parent'),
        step('parent'),
        step('child'),
        step('child', 'M'),
      ])
    ).toBe('first cousin twice removed')
  })

  it('generalizes to a numbered ordinal cousin beyond the spelled-out range', () => {
    const up = Array.from({ length: 12 }, () => step('parent'))
    const down = Array.from({ length: 11 }, () => step('child'))
    expect(computeKinshipLabel([...up, ...down, step('child', 'M')])).toBe('11th cousin')
  })
})

describe('computeKinshipLabel — spouse', () => {
  it('labels a single spouse step as husband', () => {
    expect(computeKinshipLabel([step('spouse', 'M')])).toBe('husband')
  })

  it('labels a single spouse step as wife', () => {
    expect(computeKinshipLabel([step('spouse', 'F')])).toBe('wife')
  })

  it('falls back to neutral "spouse" when sex is unset', () => {
    expect(computeKinshipLabel([step('spouse', null)])).toBe('spouse')
  })
})

describe('computeKinshipLabel — in-law and step relations', () => {
  it('labels a spouse of a parent as stepfather/stepmother', () => {
    expect(computeKinshipLabel([step('parent'), step('spouse', 'M')])).toBe('stepfather')
    expect(computeKinshipLabel([step('parent'), step('spouse', 'F')])).toBe('stepmother')
  })

  it('labels a spouse of a child as son-in-law/daughter-in-law', () => {
    expect(computeKinshipLabel([step('child'), step('spouse', 'M')])).toBe('son-in-law')
    expect(computeKinshipLabel([step('child'), step('spouse', 'F')])).toBe('daughter-in-law')
  })

  it('labels a spouse of a sibling as brother-in-law/sister-in-law', () => {
    expect(computeKinshipLabel([step('parent'), step('child'), step('spouse', 'M')])).toBe(
      'brother-in-law'
    )
    expect(computeKinshipLabel([step('parent'), step('child'), step('spouse', 'F')])).toBe(
      'sister-in-law'
    )
  })

  it('labels a parent of a spouse as father-in-law/mother-in-law', () => {
    expect(computeKinshipLabel([step('spouse'), step('parent', 'M')])).toBe('father-in-law')
    expect(computeKinshipLabel([step('spouse'), step('parent', 'F')])).toBe('mother-in-law')
  })

  it('labels a child of a spouse as stepson/stepdaughter', () => {
    expect(computeKinshipLabel([step('spouse'), step('child', 'M')])).toBe('stepson')
    expect(computeKinshipLabel([step('spouse'), step('child', 'F')])).toBe('stepdaughter')
  })

  it('labels a sibling of a spouse as brother-in-law/sister-in-law', () => {
    expect(computeKinshipLabel([step('spouse'), step('parent'), step('child', 'M')])).toBe(
      'brother-in-law'
    )
  })

  it('falls back to "by marriage" for uncommon in-law patterns', () => {
    expect(
      computeKinshipLabel([step('parent'), step('parent'), step('child'), step('spouse', 'M')])
    ).toBe('uncle by marriage')
  })
})

describe('computeKinshipLabel — distant relative fallback', () => {
  it('falls back to "distant relative (N steps)" when a spouse hop is mid-path', () => {
    expect(
      computeKinshipLabel([step('parent'), step('spouse'), step('child', 'M')])
    ).toBe('distant relative (3 steps)')
  })

  it('falls back to "distant relative (N steps)" for multiple spouse hops', () => {
    expect(computeKinshipLabel([step('spouse'), step('spouse', 'F')])).toBe(
      'distant relative (2 steps)'
    )
  })
})
