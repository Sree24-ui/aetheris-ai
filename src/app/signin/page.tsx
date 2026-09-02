"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import AuthLayout from "@/components/AuthLayout";
import GoogleIcon from "@/components/GoogleIcon";
import Icon from "@/components/Icon";

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/app";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
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
      <h1 className="font-display-lg-mobile text-[32px] text-on-surface mb-2">Welcome back</h1>
      <p className="text-sm text-on-surface-variant mb-8">Log in to continue your lessons.</p>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="text-sm font-medium text-on-surface block mb-1.5">Email address</label>
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-surface-container/50 px-4 py-3 focus-within:border-primary/40">
            <Icon name="mail" className="text-[18px] text-outline" />
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="flex-1 bg-transparent text-sm text-on-surface placeholder-outline-variant focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-on-surface block mb-1.5">Password</label>
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-surface-container/50 px-4 py-3 focus-within:border-primary/40">
            <Icon name="lock" className="text-[18px] text-outline" />
            <input
              type={showPassword ? "text" : "password"}
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="flex-1 bg-transparent text-sm text-on-surface placeholder-outline-variant focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="text-xs text-on-surface-variant hover:text-on-surface flex items-center gap-1"
            >
              <Icon name={showPassword ? "visibility_off" : "visibility"} className="text-[16px]" />
            </button>
          </div>
        </div>

        {error && (
          <div className="text-sm text-error bg-error-container/20 border border-error/30 rounded-lg p-3">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="btn-sheen w-full py-3.5 rounded-full bg-primary-container text-on-primary-container font-semibold flex items-center justify-center gap-2 relative overflow-hidden disabled:opacity-60 shadow-[0_0_20px_rgba(160,120,255,0.25)]"
        >
          {submitting ? (
            <>
              <span className="w-4 h-4 rounded-full border-2 border-on-primary-container/40 border-t-on-primary-container animate-spin" />
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

      <div className="flex items-center gap-3 my-6">
        <div className="flex-1 h-px bg-white/10" />
        <span className="text-xs text-outline">OR</span>
        <div className="flex-1 h-px bg-white/10" />
      </div>

      <button
        onClick={async () => {
          setGoogleLoading(true);
          try {
            await signIn("google", { callbackUrl });
          } catch {
            // Google is only configured in preview/production; locally the
            // redirect fails and the button would otherwise spin forever.
            setError("Google sign-in is unavailable. Use email and password, or set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
          } finally {
            setGoogleLoading(false);
          }
        }}
        disabled={googleLoading}
        className="w-full py-3.5 rounded-full border border-white/15 text-on-surface font-medium flex items-center justify-center gap-3 hover:bg-white/5 transition-colors disabled:opacity-60"
      >
        {googleLoading ? (
          <span className="w-4 h-4 rounded-full border-2 border-on-surface/30 border-t-on-surface animate-spin" />
        ) : (
          <GoogleIcon />
        )}
        Continue with Google
      </button>

      <p className="text-center text-sm text-on-surface-variant mt-8">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="text-primary-fixed-dim font-medium hover:underline">
          Sign Up
        </Link>
      </p>
    </>
  );
}

export default function SignInPage() {
  return (
    <AuthLayout tagline="Sign in to access your lessons, learning history, and progress.">
      <Suspense fallback={null}>
        <SignInForm />
      </Suspense>
    </AuthLayout>
  );
}
