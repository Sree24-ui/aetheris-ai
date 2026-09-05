import type { Metadata } from "next";
import { Inter, Montserrat } from "next/font/google";
import "./globals.css";
import "katex/dist/katex.min.css";
import AuthProvider from "@/components/AuthProvider";
import AppearanceEffect from "@/components/AppearanceEffect";
import { APP_NAME, APP_DESCRIPTION, APP_URL } from "@/lib/appConfig";
import { APPEARANCE_BOOTSTRAP } from "@/lib/appearanceBootstrap";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["600", "700"],
});

/**
 * Every page is rendered per request.
 *
 * The Content Security Policy set in proxy.ts is nonce-based, and Next.js can
 * only stamp a nonce onto its script tags while rendering a real request — a
 * page prerendered at build time has no nonce, so under `strict-dynamic` the
 * browser refuses to run its bootstrap and the app never hydrates. Static
 * optimisation is therefore traded away deliberately in exchange for a
 * script-src with no `unsafe-inline` and no `unsafe-eval`. Every page here is
 * behind authentication or is a small marketing shell, so nothing was being
 * cached at the edge that mattered.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: APP_NAME,
  description: APP_DESCRIPTION,
  openGraph: {
    title: APP_NAME,
    description: APP_DESCRIPTION,
    url: APP_URL,
    siteName: APP_NAME,
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`dark ${inter.variable} ${montserrat.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Applies the stored interface preferences before first paint; see
            src/lib/appearanceBootstrap.ts.

            Deliberately a plain <script> with no nonce, allowed by its SHA-256
            hash in the CSP. next/script's `beforeInteractive` strategy takes
            its nonce from Next's head-manager context, which is populated
            during server rendering and left empty on the client — so the
            server emitted a nonced tag that hydration expected to have none,
            and every load reported a mismatch. Hashing removes the attribute
            from the comparison and pins the exact bytes allowed to run. */}
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOTSTRAP }} />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- this rule targets the Pages Router's pages/_document.js; a global stylesheet link in the App Router root layout's <head> is the correct pattern. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col void-bg">
        <AppearanceEffect />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
