// Documentation is served from its own subdomain in production
// (docs.aegisvaults.xyz) but from the in-app /docs route during local dev.
// This module centralises that decision so every "Docs" link behaves the same.
const DOCS_SUBDOMAIN_ORIGIN = 'https://docs.aegisvaults.xyz';

// True when running on the public aegisvaults.xyz domain (apex or any
// subdomain) — i.e. anywhere the docs subdomain actually resolves. On
// localhost (or any other host) we keep documentation in-app so dev without
// the tunnel still works.
function onPublicSite() {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === 'aegisvaults.xyz' || h.endsWith('.aegisvaults.xyz');
}

// Resolve an in-app docs path (e.g. '/docs' or '/docs#contracts') to link
// props. On the public site → an external href to the docs subdomain. In local
// dev → a same-origin SPA route, so React Router <Link to> still works.
export function docsLinkProps(inAppPath = '/docs') {
  if (!onPublicSite()) {
    return { to: inAppPath };
  }
  const hashIndex = inAppPath.indexOf('#');
  const hash = hashIndex >= 0 ? inAppPath.slice(hashIndex) : '';
  return { href: `${DOCS_SUBDOMAIN_ORIGIN}/${hash}` };
}
