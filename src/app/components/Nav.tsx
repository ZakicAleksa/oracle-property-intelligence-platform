import Link from "next/link";

const links = [
  { href: "/properties", label: "Properties" },
  { href: "/tenants", label: "Tenants" },
  { href: "/businesses", label: "Businesses" },
  { href: "/contractors", label: "Contractors" },
  { href: "/search", label: "Search" },
];

export function Nav() {
  return (
    <header className="border-b border-line bg-paper-raised">
      <div className="mx-auto flex max-w-5xl items-center gap-1 px-6">
        <Link href="/" className="mr-4 py-3 font-display text-base font-semibold">
          Oracle
        </Link>
        <nav className="flex gap-1 text-sm">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="border-b-2 border-transparent px-3 py-3 text-ink-muted transition-colors hover:border-line hover:text-ink"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
