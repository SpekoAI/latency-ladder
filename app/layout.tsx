import type { Metadata } from "next";
import type { ReactNode } from "react";
import { IBM_Plex_Mono, Sora } from "next/font/google";
import Link from "next/link";

import "./globals.css";

const sora = Sora({
  subsets: ["latin"],
  weight: ["400", "700", "800"],
  variable: "--font-sora",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-plex-mono",
});

const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="4" fill="oklch(0.2 0.006 260)"/><rect x="6" y="9" width="20" height="5" rx="1" fill="oklch(0.72 0.16 145)"/><rect x="6" y="18" width="11" height="5" rx="1" fill="oklch(0.62 0.18 305)"/></svg>',
  );

export const metadata: Metadata = {
  metadataBase: new URL("https://latency.speko.dev"),
  title: "Latency Ladder - are you faster than the AI?",
  description:
    "A 60 second voice duel that measures your brain-to-mouth gap next to a live voice agent's measured response time.",
  icons: { icon: FAVICON },
  openGraph: {
    title: "Latency Ladder - are you faster than the AI?",
    description:
      "Measure your conversational latency against a live voice agent. Correct answers only. The clock is local.",
    url: "https://latency.speko.dev",
    siteName: "Latency Ladder",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${sora.variable} ${plexMono.variable}`}>
      <body>
        <div className="flex min-h-screen flex-col">
          <div className="flex-1">{children}</div>
          <footer className="tower-rule border-t">
            <div className="mx-auto flex max-w-5xl flex-col gap-3 px-6 py-8 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-chalk-dim">
                The agent you just raced runs on{" "}
                <a
                  className="font-semibold text-chalk underline decoration-signal decoration-2 underline-offset-4"
                  href="https://speko.ai?utm_source=latency-ladder&utm_medium=viral&utm_campaign=viral-3x"
                >
                  Speko
                </a>
                .
              </p>
              <nav className="flex gap-5 text-sm text-chalk-dim">
                <Link className="hover:text-chalk" href="/ladder">
                  Ladder
                </Link>
                <Link className="hover:text-chalk" href="/duel">
                  Duel
                </Link>
                <Link className="hover:text-chalk" href="/methodology">
                  Methodology
                </Link>
              </nav>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
