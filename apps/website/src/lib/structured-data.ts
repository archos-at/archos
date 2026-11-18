import type { Locale } from '../i18n/paths';
import identity from './identity';
import { socialProfiles } from './social';

export type GraphNode = Record<string, unknown>;

const homeUrl = (site: URL) => new URL('/', site).href;
const organizationId = (site: URL) => `${homeUrl(site)}#organization`;

export function siteGraph(site: URL, locale: Locale, nodes: GraphNode[] = []) {
  const home = homeUrl(site);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': organizationId(site),
        name: identity.name,
        legalName: identity.legalEntity,
        slogan: identity.tagline,
        url: home,
        logo: new URL('/icons/icon-512.png', site).href,
        email: identity.email,
        address: {
          '@type': 'PostalAddress',
          streetAddress: identity.street,
          postalCode: identity.postalCode,
          addressLocality: identity.city,
          addressCountry: identity.country,
        },
        ...(socialProfiles.length ? { sameAs: socialProfiles } : {}),
      },
      {
        '@type': 'WebSite',
        '@id': `${home}#website`,
        name: identity.name,
        url: home,
        inLanguage: locale,
        publisher: { '@id': organizationId(site) },
      },
      ...nodes,
    ],
  };
}

export function softwareApplication(site: URL, locale: Locale, description: string, path: string): GraphNode {
  return {
    '@type': 'SoftwareApplication',
    '@id': `${homeUrl(site)}#software`,
    name: identity.name,
    description,
    url: new URL(path, site).href,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    inLanguage: locale,
    publisher: { '@id': organizationId(site) },
  };
}

export interface Crumb {
  name: string;
  path: string;
}

export function breadcrumbList(site: URL, crumbs: Crumb[]): GraphNode {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: crumb.name,
      item: new URL(crumb.path, site).href,
    })),
  };
}

export function faqPage(site: URL, path: string, items: { q: string; a: string }[]): GraphNode {
  return {
    '@type': 'FAQPage',
    url: new URL(path, site).href,
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  };
}

export function blogPosting(
  site: URL,
  post: {
    headline: string;
    description: string;
    path: string;
    published: Date;
    modified?: Date;
    locale: Locale;
    section: string;
    image: string;
    author?: { name: string; jobTitle?: string; url?: string };
  },
): GraphNode {
  const url = new URL(post.path, site).href;
  return {
    '@type': 'BlogPosting',
    headline: post.headline,
    description: post.description,
    url,
    mainEntityOfPage: url,
    datePublished: post.published.toISOString(),
    dateModified: (post.modified ?? post.published).toISOString(),
    inLanguage: post.locale,
    articleSection: post.section,
    image: new URL(post.image, site).href,
    author: post.author
      ? {
          '@type': 'Person',
          name: post.author.name,
          ...(post.author.jobTitle ? { jobTitle: post.author.jobTitle } : {}),
          ...(post.author.url ? { sameAs: [post.author.url] } : {}),
        }
      : { '@id': organizationId(site) },
    publisher: { '@id': organizationId(site) },
  };
}

export function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
