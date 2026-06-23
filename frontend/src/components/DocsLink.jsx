import { Link } from 'react-router-dom';
import { docsLinkProps } from '../lib/docs';

// A link to the documentation. On the public site it points at the docs
// subdomain (docs.aegisvaults.xyz) via a plain same-tab anchor; in local dev it
// falls back to the in-app /docs route through the SPA router. `path` is the
// in-app docs path, e.g. '/docs' or '/docs#contracts'. All other props
// (className, style, event handlers) are forwarded to the rendered element.
export default function DocsLink({ path = '/docs', children, ...rest }) {
  const target = docsLinkProps(path);
  if (target.href) {
    return (
      <a {...rest} href={target.href}>
        {children}
      </a>
    );
  }
  return (
    <Link {...rest} to={target.to}>
      {children}
    </Link>
  );
}
