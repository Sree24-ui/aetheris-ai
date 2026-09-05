import { ACCENTS, DEFAULT_APPEARANCE, DENSITIES, MOTIONS } from "./appearance";

/**
 * The script that applies stored interface preferences before first paint.
 *
 * Two problems this solves at once. The preferences live in localStorage, so
 * the server cannot know them — applying them after hydration meant a viewer
 * who picked Solar Flare saw a frame of lavender on every cold load. And
 * writing them onto <html> during React's render made those attributes a
 * hydration mismatch, since the server rendered none of them. A blocking
 * script plus `suppressHydrationWarning` on <html> is the standard fix for
 * exactly this shape of problem.
 *
 * It lives here, rather than inline in the layout, because two places need the
 * exact same bytes: the layout renders them, and the proxy hashes them for the
 * CSP. The script carries no nonce — see src/lib/security/headers.ts for why a
 * hash is both stricter and the only version that hydrates cleanly.
 */
export const APPEARANCE_BOOTSTRAP = `try{
var s=JSON.parse(localStorage.getItem("aetheris.appearance.v1")||"{}");
var A=${JSON.stringify(ACCENTS)},r=document.documentElement;
var a=A[s.accent]?s.accent:${JSON.stringify(DEFAULT_APPEARANCE.accent)};
for(var k in A[a].vars)r.style.setProperty(k,A[a].vars[k]);
r.dataset.bubbles=${JSON.stringify(DENSITIES)}.indexOf(s.density)<0?${JSON.stringify(DEFAULT_APPEARANCE.density)}:s.density;
r.dataset.motion=${JSON.stringify(MOTIONS)}.indexOf(s.motion)<0?${JSON.stringify(DEFAULT_APPEARANCE.motion)}:s.motion;
}catch(e){}`;
