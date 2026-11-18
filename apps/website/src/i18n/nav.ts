import { localePath, type Locale, type RouteKey } from './paths';
import { t } from './ui';
import { linkedinUrl } from '../lib/social';

export interface NavLink {
  label: string;
  href: string;
  key?: string;
}

export function navigation(locale: Locale) {
  const ui = t(locale);
  const link = (route: RouteKey, label: string): NavLink => ({ label, href: localePath(route, locale), key: route });
  return {
    mainNav: [link('home', ui.navPlatform), link('security', ui.navSecurity), link('blog', ui.navBlog)],
    login: { label: ui.login, href: '/sign-in', key: 'login' },
    demo: link('demo', ui.demo),
    footerColumns: [
      {
        title: ui.footerProduct,
        links: [
          link('home', ui.navPlatform),
          link('security', ui.navSecurity),
          link('changelog', ui.changelog),
        ],
      },
      { title: ui.footerKnowledge, links: [link('blog', ui.navBlog)] },
      {
        title: ui.footerCompany,
        links: [
          ...(linkedinUrl ? [{ label: ui.linkedin, href: linkedinUrl, key: 'linkedin' }] : []),
          link('contact', ui.kontakt),
        ],
      },
    ] satisfies { title: string; links: NavLink[] }[],
    legal: [link('imprint', ui.impressum), link('privacy', ui.datenschutz)],
  };
}
