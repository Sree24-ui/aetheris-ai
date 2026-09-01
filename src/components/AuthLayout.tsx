import Link from "next/link";
import Icon from "./Icon";

interface AuthLayoutProps {
  tagline: string;
  children: React.ReactNode;
}

export default function AuthLayout({ tagline, children }: AuthLayoutProps) {
  return (
    <div className="min-h-screen flex items-center justify-center void-bg relative overflow-hidden px-4 py-10">
      <div className="ambient-blob blob-1" />
      <div className="ambient-blob blob-2" />

      <div className="relative z-10 w-full max-w-4xl grid lg:grid-cols-2 rounded-[2rem] overflow-hidden glass-panel">
        <div className="hidden lg:flex flex-col justify-center gap-6 p-12 relative bg-gradient-to-br from-primary-container/10 via-transparent to-secondary-container/10">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-container to-secondary-container flex items-center justify-center shrink-0">
              <Icon name="auto_awesome" className="text-on-primary text-[20px]" filled />
            </div>
            <span className="font-display-lg-mobile text-[24px] text-secondary-fixed-dim">Aetheris AI</span>
          </Link>
          <p className="font-body-lg text-body-lg text-on-surface-variant max-w-xs">{tagline}</p>

          <div className="relative h-40 mt-4">
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-24 h-24 rounded-full glass-panel flex items-center justify-center">
                <Icon name="face" className="text-4xl text-primary-fixed-dim" filled />
              </div>
            </div>
            <div className="absolute top-2 right-8 w-14 h-14 rounded-full bg-secondary-container/30 blur-sm animate-float" />
            <div className="absolute bottom-4 left-4 w-16 h-16 rounded-full bg-tertiary-container/20 blur-sm animate-float-delayed" />
          </div>
        </div>

        <div className="p-8 sm:p-12 bg-surface-container-lowest/30">{children}</div>
      </div>
    </div>
  );
}
