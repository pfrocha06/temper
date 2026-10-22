import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "cn";

const components: Components = {
  a: ({ node: _node, href, children, ...props }) => {
    const external = href !== undefined && /^https?:/i.test(href);
    return (
      <a href={href} {...props} {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}>
        {children}
      </a>
    );
  },
  img: ({ node: _node, alt, src }) => (
    // Agents' images are not fetched: an artifact must not make the browser call out.
    <span className="text-muted-foreground">[image: {alt || src}]</span>
  ),
};

/**
 * Renders untrusted markdown (artifacts, specs, approval bodies). Raw HTML is
 * skipped, never interpreted, and unsafe URL schemes are dropped.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("prose-temper", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={defaultUrlTransform} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
