import type { Metadata } from "next";
import Script from "next/script";
import { Inter, Montserrat } from "next/font/google";
import "./globals.css";
import "katex/dist/katex.min.css";
import AuthProvider from "@/components/AuthProvider";
import AppearanceEffect from "@/components/AppearanceEffect";
import { APP_NAME, APP_DESCRIPTION, APP_URL } from "@/lib/appConfig";
import { ACCENTS, DEFAULT_APPEARANCE, DENSITIES, MOTIONS } from "@/lib/appearance";

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

/**
 * Applies the stored interface preferences before first paint.
 *
 * Two problems this solves at once. The preferences live in localStorage, so
 * the server cannot know them — applying them after hydration meant a viewer
 * who picked Solar Flare saw a frame of lavender on every cold load. And
 * writing them onto <html> during React's render made those attributes a
 * hydration mismatch, since the server rendered none of them. A blocking
 * script plus `suppressHydrationWarning` on <html> is the standard fix for
 * exactly this shape of problem.
 */
const APPEARANCE_BOOTSTRAP = `try{
var s=JSON.parse(localStorage.getItem("aetheris.appearance.v1")||"{}");
var A=${JSON.stringify(ACCENTS)},r=document.documentElement;
var a=A[s.accent]?s.accent:${JSON.stringify(DEFAULT_APPEARANCE.accent)};
for(var k in A[a].vars)r.style.setProperty(k,A[a].vars[k]);
r.dataset.bubbles=${JSON.stringify(DENSITIES)}.indexOf(s.density)<0?${JSON.stringify(DEFAULT_APPEARANCE.density)}:s.density;
r.dataset.motion=${JSON.stringify(MOTIONS)}.indexOf(s.motion)<0?${JSON.stringify(DEFAULT_APPEARANCE.motion)}:s.motion;
}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`dark ${inter.variable} ${montserrat.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* `beforeInteractive` puts this in the initial HTML and runs it before
            hydration — a bare <script> here works too but makes React warn that
            scripts in components don't execute on client renders. */}
        <Script id="appearance-bootstrap" strategy="beforeInteractive">
          {APPEARANCE_BOOTSTRAP}
        </Script>
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
