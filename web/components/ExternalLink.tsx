/** Link that opens in a new tab and says so to screen readers. */
export default function ExternalLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
      <span aria-hidden> ↗</span>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
