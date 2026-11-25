import { RuleTester } from 'oxlint/plugins-dev'
import rule from './touch-target.mjs'

const ruleTester = new RuleTester({
  eslintCompat: true,
  languageOptions: { sourceType: 'module', parserOptions: { lang: 'jsx' } },
})

ruleTester.run('touch-target', rule, {
  valid: [
    `const a = <button className="size-7 pointer-coarse:size-11" />`,
    `const a = <button className="h-7 pointer-coarse:h-auto" />`,
    `const a = <a href="/x" className="min-h-6 pointer-coarse:min-h-11">x</a>`,
    `const a = <button className="touch-target size-4" />`,
    `const a = <button className="size-11 sm:size-7" />`,
    `const a = <Button size="icon" className="size-7" />`,
    `const a = <BusyButton className="h-[42px]" />`,
    `const a = <div className="h-6" />`,
    `const a = <span className="size-4" />`,
  ],
  invalid: [
    { code: `const a = <button className="size-7" />`, errors: [{ messageId: 'small' }] },
    { code: `const a = <Link href="/x" className="min-h-6">x</Link>`, errors: [{ messageId: 'small' }] },
    { code: `const a = <div role="button" className={cn('h-8', on && 'bg-card')} />`, errors: [{ messageId: 'small' }] },
    { code: `const a = <div onClick={go} className="min-h-10" />`, errors: [{ messageId: 'small' }] },
    { code: `const a = <button className="h-7 pointer-coarse:h-10" />`, errors: [{ messageId: 'small' }] },
    { code: `const a = <button className="h-[32px]" />`, errors: [{ messageId: 'small' }] },
  ],
})
