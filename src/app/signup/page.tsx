"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import AuthLayout from "@/components/AuthLayout";
import GoogleIcon from "@/components/GoogleIcon";
import Icon from "@/components/Icon";
import { MIN_PASSWORD_LENGTH } from "@/lib/appConfig";

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState("");
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
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not create your account.");
        return;
      }

      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.error) {
        setError("Account created — please log in.");
        router.push("/signin");
        return;
      }
      router.push("/app");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <h1 className="font-display-lg-mobile text-[32px] text-on-surface mb-2 text-center">Create your account</h1>
      <p className="text-sm text-on-surface-variant mb-8 text-center">Start learning in a couple of minutes.</p>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="font-label-caps text-label-caps text-on-surface-variant block uppercase tracking-wider ml-4 mb-2">Full name</label>
          <div className="flex items-center gap-3 rounded-full border border-white/8 bg-surface-container-low/70 backdrop-blur-md px-5 py-4 transition-colors focus-within:border-primary/40">
            <Icon name="person" className="text-[20px] text-primary" />
            <input
              type="text"
              required
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ada Lovelace"
              className="flex-1 bg-transparent font-body-md text-body-md text-on-surface placeholder-on-surface-variant/50 focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label className="font-label-caps text-label-caps text-on-surface-variant block uppercase tracking-wider ml-4 mb-2">Email address</label>
          <div className="flex items-center gap-3 rounded-full border border-white/8 bg-surface-container-low/70 backdrop-blur-md px-5 py-4 transition-colors focus-within:border-primary/40">
            <Icon name="mail" className="text-[20px] text-primary" />
            <input
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
          <label className="font-label-caps text-label-caps text-on-surface-variant block uppercase tracking-wider ml-4 mb-2">Password</label>
          <div className="flex items-center gap-3 rounded-full border border-white/8 bg-surface-container-low/70 backdrop-blur-md px-5 py-4 transition-colors focus-within:border-primary/40">
            <Icon name="lock" className="text-[20px] text-primary" />
            <input
              type={showPassword ? "text" : "password"}
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              className="flex-1 bg-transparent font-body-md text-body-md text-on-surface placeholder-on-surface-variant/50 focus:outline-none"
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
          className="btn-sheen w-full mt-2 py-4 rounded-full bg-tertiary text-on-tertiary font-body-lg text-body-lg font-medium flex items-center justify-center gap-2 relative overflow-hidden disabled:opacity-60 shadow-[0_4px_14px_0_rgba(236,106,6,0.3)] hover:shadow-[0_6px_20px_0_rgba(236,106,6,0.5)] hover:-translate-y-0.5 transition-all duration-300"
        >
          {submitting ? (
            <>
              <span className="w-4 h-4 rounded-full border-2 border-on-tertiary/40 border-t-on-tertiary animate-spin" />
              Creating account...
            </>
          ) : (
            <>
              Sign Up
              <Icon name="arrow_forward" className="text-lg" />
            </>
          )}
        </button>
      </form>

      <div className="flex items-center gap-3 my-6">
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-on-surface-variant/20 to-transparent" />
        <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">Or</span>
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-on-surface-variant/20 to-transparent" />
      </div>

      <button
        onClick={() => {
          setGoogleLoading(true);
          signIn("google", { callbackUrl: "/app" });
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

      <p className="text-center text-sm text-on-surface-variant mt-8">
        Already have an account?{" "}
        <Link href="/signin" className="text-primary font-medium hover:text-primary-fixed hover:underline transition-colors">
          Log In
        </Link>
      </p>
    </AuthLayout>
  );
}
