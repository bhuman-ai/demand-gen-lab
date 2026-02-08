import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import BrandSwitcher from "./brand-switcher";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "The Factory",
  description: "Autonomous genetic outreach engine",
};

const navItems = [
  { href: "/projects", label: "Brands" },
  { href: "/strategy", label: "Strategy" },
  { href: "/hypotheses", label: "Hypotheses" },
  { href: "/evolution", label: "Evolution" },
  { href: "/network", label: "Network" },
  { href: "/leads", label: "Leads" },
  { href: "/inbox", label: "Inbox" },
  { href: "/logic", label: "Logic" },
  { href: "/doctor", label: "Doctor" },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <div className="min-h-screen bg-[color:var(--background)] text-[color:var(--foreground)]">
          <div className="flex min-h-screen">
            <aside className="w-60 border-r border-[color:var(--border)] bg-[color:var(--glass)]/80 px-4 py-6">
              <div className="text-xs uppercase tracking-[0.2em] text-[color:var(--muted)]">
                Protocol Genesis
              </div>
              <div className="mt-2 text-lg font-semibold text-[color:var(--foreground)]">
                The Factory
              </div>
              <nav className="mt-6 space-y-2 text-sm">
                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="block rounded-md border border-transparent px-3 py-2 text-[color:var(--muted)] hover:border-[color:var(--border)] hover:bg-[color:var(--background-elevated)] hover:text-[color:var(--foreground)]"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </aside>
            <main className="flex-1">
              <header className="flex items-center justify-between border-b border-[color:var(--border)] bg-[color:var(--glass)]/60 px-6 py-4">
                <BrandSwitcher />
                <div className="text-xs text-[color:var(--muted)]">v0.1</div>
              </header>
              <div className="px-6 py-6">{children}</div>
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
