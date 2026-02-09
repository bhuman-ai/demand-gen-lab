import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import BrandSwitcher from "./brand-switcher";
import Sidebar from "./sidebar";

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
            <Sidebar />
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
