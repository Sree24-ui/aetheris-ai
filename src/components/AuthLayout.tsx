import Link from "next/link";
import Icon from "./Icon";

interface AuthLayoutProps {
  children: React.ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden px-4 py-12">
      <div className="absolute -top-32 -left-32 w-[600px] h-[600px] rounded-full bg-secondary-fixed/5 blur-[120px] pointer-events-none" />
      <div className="absolute -bottom-32 -right-32 w-[500px] h-[500px] rounded-full bg-primary/5 blur-[100px] pointer-events-none" />

      <Link href="/" className="relative z-10 flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-primary to-secondary flex items-center justify-center shadow-[0_0_20px_rgba(208,188,255,0.3)]">
          <Icon name="auto_awesome" className="text-on-primary text-[20px]" filled />
        </div>
        <span className="font-headline-md text-headline-md text-on-surface tracking-tight">Aetheris AI</span>
      </Link>

      <div className="relative z-10 w-full max-w-md rounded-[2rem] p-8 backdrop-blur-[20px] bg-white/[0.02] border border-primary/10 shadow-[0_8px_32px_0_rgba(109,59,215,0.05)] hover:border-primary/20 hover:shadow-[0_12px_48px_0_rgba(109,59,215,0.1)] transition-all duration-500 ease-out">
        {children}
      </div>
    </div>
  );
}
