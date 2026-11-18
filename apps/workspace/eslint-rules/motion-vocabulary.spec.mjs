/**
 * The guard on the guard, same reasoning as card-type-scale.spec.mjs. The
 * literal-duration pattern has two opposite silent failure modes: miss
 * `duration-200` and the sweep that removed forty of them un-ratchets, or
 * flag `duration-snap` / `data-[state=open]:duration-base` and the next
 * author disables the rule.
 */

import { RuleTester } from 'oxlint/plugins-dev'
import rule from './motion-vocabulary.mjs'

const ruleTester = new RuleTester({
  eslintCompat: true,
  languageOptions: { sourceType: 'module', parserOptions: { lang: 'jsx' } },
})

ruleTester.run('motion-vocabulary', rule, {
  valid: [
    `const a = 'transition-colors duration-snap ease-out'`,
    `const a = 'transition-opacity duration-quick motion-reduce:transition-none'`,
    `const a = 'animate-in fade-in-0 duration-base ease-entrance'`,
    `const a = 'data-[state=open]:duration-deliberate data-[state=open]:ease-entrance'`,
    `const a = 'hover:duration-snap md:duration-quick'`,
    `const a = 'animate-spin duration-ambient ease-cycle'`,
    `const a = 'transition-transform ease-exit'`,
    `const a = 'transition-[color,scale] active:scale-[0.98]'`,
    `const a = 'transition-[opacity,transform] duration-quick'`,
    `const a = 'duration-snappy'`,
    `const a = 'animate-caret-breathe motion-reduce:animate-none'`,
    `const a = 'animate-typing-dot animate-progress-sweep ease-entrance'`,
    `const x = <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} />`,
    `const x = <motion.div style={{ height: 40 }} layout />`,
    `const x = <motion.div variants={v} initial="hidden" animate="visible" />`,
    `const x = <motion.span initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ ...springSnap, opacity: motionQuick }} />`,
    `const x = <motion.span animate={{ opacity: 1, scale: 1, transition: swap.enter }} exit={{ opacity: 0, transition: motionQuickExit }} transition={springSnap} />`,
    `const x = <motion.div animate={{ scale: 0.99 }} transition={springPress} />`,
    `const x = <motion.span layoutId="pill" transition={springGlide} />`,
    `const x = <motion.div whileTap={{ scale: 0.99, transition: springPress }} />`,
    `const x = <motion.span initial={{ opacity: 0 }} animate="shown" transition={springSnap} />`,
    `const x = <motion.span animate={{ opacity: 1 }} transition={springSnapLinear} />`,
    `const x = <motion.span animate={{ opacity: 1 }} transition={landing} />`,
  ],
  invalid: [
    {
      code: `const a = 'transition-[color,transform] duration-quick active:scale-[0.98]'`,
      errors: [{ messageId: 'transformList' }],
    },
    {
      code: `const a = 'transition-[opacity,transform] data-[state=checked]:translate-x-4'`,
      errors: [{ messageId: 'transformList' }],
    },
    {
      code: `const a = 'transition-colors duration-200 ease-out'`,
      errors: [{ messageId: 'literalDuration' }],
    },
    {
      code: `const a = 'duration-75 duration-100 duration-150 duration-300 duration-500 duration-700 duration-1000'`,
      errors: Array(7).fill({ messageId: 'literalDuration' }),
    },
    {
      code: `const a = 'duration-[180ms]'`,
      errors: [{ messageId: 'literalDuration' }],
    },
    {
      code: `const a = 'md:duration-200 duration-150!'`,
      errors: [{ messageId: 'literalDuration' }, { messageId: 'literalDuration' }],
    },
    {
      code: 'const a = `duration-500 ${x}`',
      errors: [{ messageId: 'literalDuration' }],
    },
    {
      code: `const a = 'transition-all'`,
      errors: [{ messageId: 'transitionAll' }],
    },
    {
      code: `const a = 'ease-linear'`,
      errors: [{ messageId: 'easeLinear' }],
    },
    {
      code: `const a = 'transition-[width]'`,
      errors: [{ messageId: 'layoutTransition' }],
    },
    {
      code: `const a = '[animation-delay:160ms] motion-safe:[animation-duration:2s]'`,
      errors: [
        { messageId: 'arbitraryAnimationTiming' },
        { messageId: 'arbitraryAnimationTiming' },
      ],
    },
    {
      code: `const a = 'motion-safe:animate-pulse'`,
      errors: [{ messageId: 'animatePulse' }],
    },
    {
      code: `const a = 'ease-in-out ease-in'`,
      errors: [{ messageId: 'offVocabularyEasing' }, { messageId: 'offVocabularyEasing' }],
    },
    {
      code: `const x = <motion.div\n  initial={{ height: 0, opacity: 0 }}\n  animate={{ height: 'auto', opacity: 1 }}\n  exit={{ height: 0 }}\n/>`,
      errors: [{ messageId: 'motionLayoutKey', line: 1 }],
    },
    {
      code: `const x = <motion.div animate={{ 'width': 10, top: 4, left: 0 }} />`,
      errors: [{ messageId: 'motionLayoutKey' }],
    },
    {
      code: `const x = <motion.span\n  initial={{ opacity: 0, scale: 0.6 }}\n  animate={{ opacity: 1, scale: 1 }}\n  exit={{ opacity: 0, scale: 0.6 }}\n  transition={springSnap}\n/>`,
      errors: [{ messageId: 'springOpacity', line: 1 }],
    },
    {
      code: `const x = <>
        <motion.li animate={{ opacity: 1 }} transition={springDrawer} />
        <motion.li animate={{ opacity: 1 }} transition={springGlide} />
        <motion.li animate={{ opacity: 1 }} transition={springPress} />
        <motion.li animate={{ opacity: 1 }} transition={springSnappy} />
        <motion.li animate={{ opacity: 1 }} transition={springGentle} />
      </>`,
      errors: Array(5).fill({ messageId: 'springOpacity' }),
    },
    {
      code: `const x = <motion.span animate={{ opacity: 1, transition: springSnap }} />`,
      errors: [{ messageId: 'springOpacity' }],
    },
    {
      code: `const x = <>
        <motion.span animate={{ opacity: 1 }} transition={{ ...springSnap, delay: 0.1 }} />
        <motion.span animate={{ opacity: 1 }} transition={{ type: 'spring', stiffness: 400 }} />
      </>`,
      errors: [{ messageId: 'springOpacity' }, { messageId: 'springOpacity' }],
    },
    {
      code: `const x = <>
        <motion.span animate={{ opacity: 1 }} transition={reduced ? motionInstant : springSnap} />
        <motion.span whileHover={{ opacity: 0.8 }} transition={springPress} />
      </>`,
      errors: [{ messageId: 'springOpacity' }, { messageId: 'springOpacity' }],
    },
    {
      code: `const x = <motion.span exit={{ opacity: 0 }} transition={{ ...springSnap, opacity: springPress }} />`,
      errors: [{ messageId: 'springOpacity' }],
    },
  ],
})
