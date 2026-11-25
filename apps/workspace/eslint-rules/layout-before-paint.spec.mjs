import { RuleTester } from 'oxlint/plugins-dev'
import rule from './layout-before-paint.mjs'

const ruleTester = new RuleTester({
  eslintCompat: true,
  languageOptions: { sourceType: 'module', parserOptions: { lang: 'jsx' } },
})

ruleTester.run('layout-before-paint', rule, {
  valid: [
    `function A() { const isMobile = useIsMobile(); return <Sheet side={isMobile ? 'bottom' : 'right'} /> }`,
    `function A() { const isMobile = useIsMobile(); return <Button aria-label={isMobile ? a : b} /> }`,
    `function A() { const isMobile = useIsMobile(); useBadge(enabled && isMobile); return <nav /> }`,
    `function A() { const isMobile = useIsMobile(); const open = () => openFile({ isMobile }); return <button onClick={open} /> }`,
    `function A() { const isMobile = useIsMobile(); return <Panel initialFocusRef={isMobile ? undefined : ref} /> }`,
    `function A() { const isMobile = useIsMobile(); if (isMobile) setOpen(false); return <div /> }`,
    `function A() { const isMobile = useIsMobile(); const onClick = (event) => { if (isMobile || event.metaKey) return; go() }; return <a onClick={onClick} /> }`,
    `function A() { const desktop = !useIsMobile(); useHeightGlide(ref, desktop && open ? key : null); return <div /> }`,
    `function A() { const phone = useIsMobileOnceKnown() === true; return phone ? <Sheet /> : null }`,
    `function A() { return <><MobileLayoutOnly><Stack /></MobileLayoutOnly><DesktopLayoutOnly><Table /></DesktopLayoutOnly></> }`,
  ],
  invalid: [
    {
      code: `function A() { const isMobile = useIsMobile(); return isMobile ? <Stack /> : <Table /> }`,
      errors: [{ messageId: 'structural' }],
    },
    {
      code: `function A() { const isMobile = useIsMobile(); return <div>{isMobile && <Band />}</div> }`,
      errors: [{ messageId: 'structural' }],
    },
    {
      code: `function A() { const isMobile = useIsMobile(); return <div>{isMobile && file && mode !== 'modal' && <Button />}</div> }`,
      errors: [{ messageId: 'structural' }],
    },
    {
      code: `function A() { const isMobile = useIsMobile(); return <div>{!isMobile && <Actions />}</div> }`,
      errors: [{ messageId: 'structural' }],
    },
    {
      code: `function A() { const desktop = !useIsMobile(); return <Frame rail={desktop ? rail : null} /> }`,
      errors: [{ messageId: 'structural' }],
    },
    {
      code: `function A() { const isMobile = useIsMobile(); return <Button>{isMobile ? t('short') : t('long')}</Button> }`,
      errors: [{ messageId: 'structural' }],
    },
    {
      code: `function A() { const isMobile = useIsMobile(); if (isMobile) return null; return <aside /> }`,
      errors: [{ messageId: 'structural' }],
    },
    {
      code: `function A() { return useIsMobile() ? <Stack /> : <Table /> }`,
      errors: [{ messageId: 'structural' }],
    },
  ],
})
