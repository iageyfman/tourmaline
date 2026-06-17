import { defaultUrlTransform, type Components } from "react-markdown";

/**
 * The shared `[[wiki link]]` anchor renderer for the preview (1.5) and inside embeds (3.3).
 * `wiki:<title>` links (produced by remarkWikiLink) become clickable — resolved vs unresolved is
 * styled against the live `titles` set; clicking navigates (resolved → open, unresolved →
 * create-then-open via app-shell's onNavigate). Non-wiki links render normally. Factored out so
 * the top-level preview and the nested embed renderer can't drift.
 */
export function wikiAnchor(
  titles: Set<string>,
  onNavigate: (title: string) => void,
): Components["a"] {
  return function A({ href, children, node: _node, ...props }) {
    if (href && href.startsWith("wiki:")) {
      const title = href.slice(5);
      const resolved = titles.has(title.toLowerCase());
      return (
        <a
          href={href}
          className={resolved ? "wiki-link" : "wiki-link wiki-unresolved"}
          onClick={(e) => {
            e.preventDefault();
            onNavigate(title);
          }}
        >
          {children}
        </a>
      );
    }
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  };
}

/** Preserve our `wiki:` scheme; react-markdown's default sanitizer would otherwise strip it. */
export function wikiUrlTransform(url: string): string {
  return url.startsWith("wiki:") ? url : defaultUrlTransform(url);
}
