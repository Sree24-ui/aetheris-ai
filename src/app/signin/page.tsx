"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getProviders, signIn } from "next-auth/react";
import AuthLayout from "@/components/AuthLayout";
import GoogleIcon from "@/components/GoogleIcon";
import Icon from "@/components/Icon";
import { safeCallbackPath, safeCallbackUrl } from "@/lib/security/callbackUrl";

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // C2: `?callbackUrl=` is attacker-controlled — a crafted sign-in link used
  // to be able to bounce the freshly-authenticated learner anywhere. The same
  // validator runs on the server (see proxy.ts), so both sides agree on what
  // an approved internal destination is.
  const callbackUrl = safeCallbackPath(searchParams.get("callbackUrl"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  // Google is optional: without GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET the
  // provider isn't registered, and showing the button anyway sent people to
  // /api/auth/error?error=Configuration with no explanation.
  const [googleAvailable, setGoogleAvailable] = useState(false);

  useEffect(() => {
    getProviders()
      .then((providers) => setGoogleAvailable(Boolean(providers?.google)))
      .catch(() => setGoogleAvailable(false));
  }, []);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (result?.error) {
        // Only "CredentialsSignin" actually means the email/password was
        // wrong. Anything else (a missing AUTH_SECRET, an unreachable
        // database) is a server problem, and reporting it as bad credentials
        // sends the user off resetting a password that was never the issue.
        setError(
          result.error === "CredentialsSignin"
            ? "Incorrect email or password."
            : "Sign-in is unavailable right now — the server could not complete the request. Check the server logs; a missing DATABASE_URL or AUTH_SECRET is the usual cause."
        );
      } else {
        router.push(callbackUrl);
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <h1 className="font-display-lg-mobile text-[32px] text-on-surface mb-2 text-center">Welcome back</h1>
      <p className="text-sm text-on-surface-variant mb-8 text-center">Log in to continue your lessons.</p>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="signin-email" className="font-label-caps text-label-caps text-on-surface-variant block uppercase tracking-wider ml-4 mb-2">Email address</label>
          <div className="flex items-center gap-3 rounded-full border border-white/8 bg-surface-container-low/70 backdrop-blur-md px-5 py-4 transition-colors focus-within:border-primary/40">
            <Icon name="mail" className="text-[20px] text-primary" />
            <input
              id="signin-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="flex-1 bg-transparent font-body-md text-body-md text-on-surface placeholder-on-surface-variant/50 focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label htmlFor="signin-password" className="font-label-caps text-label-caps text-on-surface-variant block uppercase tracking-wider ml-4 mb-2">Password</label>
          <div className="flex items-center gap-3 rounded-full border border-white/8 bg-surface-container-low/70 backdrop-blur-md px-5 py-4 transition-colors focus-within:border-primary/40">
            <Icon name="lock" className="text-[20px] text-primary" />
            <input
              id="signin-password"
              type={showPassword ? "text" : "password"}
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="flex-1 bg-transparent font-body-md text-body-md text-on-surface placeholder-on-surface-variant/50 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              // M12: an icon-only control needs a name of its own, and one
              // that says what it will do rather than what is on screen.
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              className="text-xs text-on-surface-variant hover:text-on-surface flex items-center gap-1"
            >
              <Icon name={showPassword ? "visibility_off" : "visibility"} className="text-[16px]" aria-hidden />
            </button>
          </div>
        </div>

        {error && (
          <div role="alert" className="text-sm text-error bg-error-container/20 border border-error/30 rounded-lg p-3">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="btn-sheen w-full mt-2 py-4 rounded-full bg-tertiary text-on-tertiary font-body-lg text-body-lg font-medium flex items-center justify-center gap-2 relative overflow-hidden disabled:opacity-60 shadow-[0_4px_14px_0_rgba(236,106,6,0.3)] hover:shadow-[0_6px_20px_0_rgba(236,106,6,0.5)] hover:-translate-y-0.5 transition-all duration-300"
        >
          {submitting ? (
            <>
              <span className="w-4 h-4 rounded-full border-2 border-on-tertiary/40 border-t-on-tertiary animate-spin" />
              Logging in...
            </>
          ) : (
            <>
              Log In
              <Icon name="arrow_forward" className="text-lg" />
            </>
          )}
        </button>
      </form>

      {googleAvailable && (
        <>
        <div className="flex items-center gap-3 my-6">
          <div className="flex-1 h-px bg-gradient-to-r from-transparent via-on-surface-variant/20 to-transparent" />
          <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">Or</span>
          <div className="flex-1 h-px bg-gradient-to-r from-transparent via-on-surface-variant/20 to-transparent" />
        </div>

        <button
          onClick={async () => {
            setGoogleLoading(true);
            try {
              // NextAuth needs an absolute URL here; the origin always comes
              // from this browsing context, never from the query string.
              await signIn("google", {
                callbackUrl: safeCallbackUrl(callbackUrl, window.location.origin),
              });
            } catch {
              // Google is only configured in preview/production; locally the
              // redirect fails and the button would otherwise spin forever.
              setError("Google sign-in is unavailable. Use email and password, or set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
            } finally {
              setGoogleLoading(false);
            }
          }}
          disabled={googleLoading}
          className="w-full py-4 rounded-full bg-surface/30 backdrop-blur-md border border-white/5 text-on-surface font-medium flex items-center justify-center gap-3 hover:bg-surface/50 hover:border-primary/30 transition-all duration-300 disabled:opacity-60"
        >
          {googleLoading ? (
            <span className="w-4 h-4 rounded-full border-2 border-on-surface/30 border-t-on-surface animate-spin" />
          ) : (
            <GoogleIcon />
          )}
          Continue with Google
        </button>
        </>
      )}

      <p className="text-center text-sm text-on-surface-variant mt-8">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="text-primary font-medium hover:text-primary-fixed hover:underline transition-colors">
          Sign Up
        </Link>
      </p>
    </>
  );
}

export default function SignInPage() {
  return (
    <AuthLayout>
      <Suspense fallback={null}>
        <SignInForm />
      </Suspense>
    </AuthLayout>
  );
}
