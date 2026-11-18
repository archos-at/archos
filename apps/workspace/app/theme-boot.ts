export const LAYOUT_STORE_KEY = 'layout'

export const THEME_COLOR = { light: '#fafaf9', dark: '#0f0e0d' } as const

export const THEME_BOOT_SCRIPT =
  '(function(){var t;try{var s=JSON.parse(localStorage.getItem("layout")||"null");t=s&&s.state&&s.state.theme}catch(e){}var dark=t==="dark"||(t!=="light"&&!!window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",dark)})()'
