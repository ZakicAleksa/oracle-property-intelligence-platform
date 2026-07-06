import Link from "next/link";

const links = [
  { href: "/properties", label: "Properties" },
  { href: "/tenants", label: "Tenants" },
  { href: "/businesses", label: "Businesses" },
  { href: "/contractors", label: "Contractors" },
  { href: "/search", label: "Semantic Search" },
];

export function Nav() {
  return (
    <nav className="flex gap-4 border-b border-zinc-200 px-6 py-3 text-sm dark:border-zinc-800">
      <Link href="/" className="font-semibold">
        Oracle
      </Link>
      {links.map((link) => (
        <Link key={link.href} href={link.href} className="text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-white">
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
