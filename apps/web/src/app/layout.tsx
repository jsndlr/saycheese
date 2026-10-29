import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Figtree } from "next/font/google";

import "../index.css";

import Header from "@/components/header";
import Providers from "@/components/providers";
import { getToken } from "@/lib/auth-server";

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["opsz", "wdth"],
  variable: "--font-bricolage",
  display: "swap",
});

const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "saycheese: score your smile",
    template: "%s | saycheese",
  },
  description:
    "Upload a selfie and get a fun 0 to 100 smile score in seconds. An automated estimate, just for fun.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf8f7" },
    { media: "(prefers-color-scheme: dark)", color: "#140f0e" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const token = await getToken();
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${bricolage.variable} ${figtree.variable}`}
    >
      <body className="antialiased">
        <Providers initialToken={token}>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-paper"
          >
            Skip to content
          </a>
          <div className="flex min-h-svh flex-col">
            <Header />
            <main id="main" tabIndex={-1} className="flex flex-1 flex-col outline-none">
              {children}
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
