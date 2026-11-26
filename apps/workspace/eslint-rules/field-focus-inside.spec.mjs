import { RuleTester } from './rule-tester.mjs'
import rule from './field-focus-inside.mjs'

const ruleTester = new RuleTester({
  eslintCompat: true,
  languageOptions: { sourceType: 'module', parserOptions: { lang: 'jsx' } },
})

ruleTester.run('field-focus-inside', rule, {
  valid: [
    `const a = <input className="border focus-visible:border-ring focus-visible:outline-hidden!" />`,
    `const a = <input className="focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60" />`,
    `const a = <textarea className="focus-visible:ring-0" />`,
    `const a = <div className="focus-visible:ring-2 focus-visible:ring-offset-2" />`,
    `const a = <Input className="focus-visible:ring-2" />`,
    `const a = <input type="file" className="hidden" />`,
  ],
  invalid: [
    {
      code: `const a = <input className="h-8 border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50" />`,
      errors: [{ messageId: 'outward' }],
    },
    {
      code: `const a = <textarea className={cn('border', open && 'focus:ring')} />`,
      errors: [{ messageId: 'outward' }],
    },
    {
      code: 'const a = <input className={`x ${y} focus-visible:ring-offset-2`} />',
      errors: [{ messageId: 'outward' }],
    },
    {
      code: `const a = <input className="md:focus-visible:outline-offset-2" />`,
      errors: [{ messageId: 'outward' }],
    },
  ],
})
