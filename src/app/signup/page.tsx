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
    <AuthLayout tagline="Create an account to save your lessons, history, and learning progress.">
      <h1 className="font-display-lg-mobile text-[32px] text-on-surface mb-2">Create your account</h1>
      <p className="text-sm text-on-surface-variant mb-8">Start learning in a couple of minutes.</p>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="text-sm font-medium text-on-surface block mb-1.5">Full name</label>
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-surface-container/50 px-4 py-3 focus-within:border-primary/40">
            <Icon name="person" className="text-[18px] text-outline" />
            <input
              type="text"
              required
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ada Lovelace"
              className="flex-1 bg-transparent text-sm text-on-surface placeholder-outline-variant focus:outline-none"
            />
          </div>
        </div>

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
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
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
        <div className="flex-1 h-px bg-white/10" />
        <span className="text-xs text-outline">OR</span>
        <div className="flex-1 h-px bg-white/10" />
      </div>

      <button
        onClick={() => {
          setGoogleLoading(true);
          signIn("google", { callbackUrl: "/app" });
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
        Already have an account?{" "}
        <Link href="/signin" className="text-primary-fixed-dim font-medium hover:underline">
          Log In
        </Link>
      </p>
    </AuthLayout>
  );
}
