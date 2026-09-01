import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import Icon from "@/components/Icon";

const FEATURES = [
  {
    icon: "menu_book",
    title: "RAG-Grounded Lessons",
    description: "Upload a textbook, PDF, or slide deck and the AI teaches from it directly — retrieval-grounded, not guessed.",
  },
  {
    icon: "face",
    title: "Avatar + Natural Voice",
    description: "A speaking avatar narrates every lesson with browser-native text-to-speech, synced captions, and subject-aware visuals.",
  },
  {
    icon: "language",
    title: "22 Languages",
    description: "Teach and switch languages mid-lesson — Hindi, Spanish, Tamil, Arabic, and 18 more — without losing lesson context.",
  },
  {
    icon: "psychology",
    title: "Misconception Detection",
    description: "Wrong answers get diagnosed, not just marked incorrect — the AI identifies the specific misunderstanding and re-teaches it.",
  },
  {
    icon: "quiz",
    title: "Adaptive Assessment",
    description: "Checkpoint questions during the lesson and a full quiz after, graded with a real learning report — strengths, gaps, and what's next.",
  },
  {
    icon: "history",
    title: "Persistent History",
    description: "Every lesson's full conversation is saved to your account — revisit exactly what was taught and discussed, any time.",
  },
];

const STEPS = [
  { icon: "upload_file", label: "Upload or pick a topic" },
  { icon: "auto_awesome", label: "AI plans the lesson" },
  { icon: "smart_display", label: "Teaching video plays" },
  { icon: "checklist", label: "Adapts to your answers" },
];

export default async function LandingPage() {
  const session = await auth();
  if (session?.user) redirect("/app");

  return (
    <div className="min-h-screen flex flex-col void-bg relative overflow-hidden">
      <div className="ambient-blob blob-1" />
      <div className="ambient-blob blob-2" />

      <header className="relative z-10 flex items-center justify-between max-w-7xl mx-auto w-full px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary-container to-secondary-container flex items-center justify-center shrink-0">
            <Icon name="auto_awesome" className="text-on-primary text-[18px]" filled />
          </div>
          <span className="font-display-lg-mobile text-[20px] text-secondary-fixed-dim">Aetheris AI</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/signin"
            className="px-4 py-2 rounded-full text-sm text-on-surface-variant hover:text-on-surface transition-colors"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="btn-sheen px-5 py-2 rounded-full bg-primary-container text-on-primary-container text-sm font-semibold relative overflow-hidden shadow-[0_0_20px_rgba(160,120,255,0.25)]"
          >
            Get Started
          </Link>
        </div>
      </header>

      <main className="relative z-10 flex-1 max-w-7xl mx-auto w-full px-6">
        <section className="grid lg:grid-cols-2 gap-12 items-center py-16 lg:py-24">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full glass-panel px-4 py-1.5 text-xs text-on-surface-variant mb-6">
              <Icon name="auto_awesome" className="text-[16px] text-primary-fixed-dim" filled />
              Introducing Adaptive AI Teaching
            </div>
            <h1 className="font-display-lg text-display-lg-mobile md:text-display-lg text-on-surface leading-[1.05] mb-6">
              Learn anything,
              <br />
              taught{" "}
              <span className="text-primary-fixed-dim underline decoration-primary/40 underline-offset-8">
                like a real class.
              </span>
            </h1>
            <p className="font-body-lg text-body-lg text-on-surface-variant max-w-lg mb-8">
              Aetheris AI turns a topic — or your own textbook, notes, or slides — into a personalized video
              lesson: a speaking avatar, subject-aware diagrams, live checkpoint questions, and a real
              assessment at the end. Not a chatbot. An actual teacher.
            </p>
            <div className="flex flex-wrap items-center gap-4 mb-10">
              <Link
                href="/signup"
                className="btn-sheen px-8 py-4 rounded-full bg-primary-container text-on-primary-container font-semibold flex items-center gap-2 relative overflow-hidden shadow-[0_0_24px_rgba(160,120,255,0.3)]"
              >
                Get Started
                <Icon name="arrow_forward" className="text-lg" />
              </Link>
              <a
                href="#how-it-works"
                className="px-6 py-4 rounded-full glass-panel text-on-surface font-medium flex items-center gap-2 glow-hover"
              >
                <Icon name="play_circle" className="text-lg" />
                See how it works
              </a>
            </div>
            <div className="flex flex-wrap gap-3">
              <span className="glass-panel rounded-full px-4 py-2 text-xs text-on-surface-variant flex items-center gap-2">
                <Icon name="translate" className="text-[16px] text-secondary-fixed-dim" />
                22 languages
              </span>
              <span className="glass-panel rounded-full px-4 py-2 text-xs text-on-surface-variant flex items-center gap-2">
                <Icon name="hub" className="text-[16px] text-tertiary-fixed-dim" />
                RAG-grounded
              </span>
              <span className="glass-panel rounded-full px-4 py-2 text-xs text-on-surface-variant flex items-center gap-2">
                <Icon name="graphic_eq" className="text-[16px] text-primary-fixed-dim" />
                Voice + avatar
              </span>
            </div>
          </div>

          <div className="relative h-[420px] hidden lg:block">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-44 h-44 rounded-full glass-panel flex flex-col items-center justify-center gap-2 shadow-2xl">
              <Icon name="face" className="text-4xl text-primary-fixed-dim" filled />
              <span className="text-xs font-semibold text-on-surface text-center px-4">AI Teacher</span>
            </div>
            <div className="absolute top-4 right-8 w-32 h-32 rounded-full glass-panel flex flex-col items-center justify-center gap-1.5 animate-float">
              <Icon name="quiz" className="text-2xl text-secondary-fixed-dim" />
              <span className="text-[10px] font-medium text-on-surface-variant text-center px-2">Adaptive Quizzes</span>
            </div>
            <div className="absolute bottom-10 left-2 w-28 h-28 rounded-full glass-panel flex flex-col items-center justify-center gap-1.5 animate-float-delayed">
              <Icon name="menu_book" className="text-2xl text-tertiary-fixed-dim" />
              <span className="text-[10px] font-medium text-on-surface-variant text-center px-2">RAG Grounded</span>
            </div>
            <div className="absolute bottom-2 right-4 w-24 h-24 rounded-full glass-panel flex flex-col items-center justify-center gap-1 animate-float">
              <Icon name="translate" className="text-xl text-primary-fixed-dim" />
              <span className="text-[10px] font-medium text-on-surface-variant text-center px-2">Multilingual</span>
            </div>
            <div className="absolute top-16 left-0 w-20 h-20 rounded-full glass-panel flex flex-col items-center justify-center gap-1 animate-float-delayed">
              <Icon name="psychology" className="text-xl text-secondary-fixed-dim" />
            </div>
          </div>
        </section>

        <section id="how-it-works" className="py-16 border-t border-white/10">
          <h2 className="font-headline-md text-headline-md text-on-surface text-center mb-10">How it works</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {STEPS.map((step, i) => (
              <div key={step.label} className="glass-panel rounded-2xl p-6 flex flex-col items-center text-center gap-3 relative">
                <span className="absolute top-3 left-4 text-xs font-label-caps text-outline">{`0${i + 1}`}</span>
                <div className="w-12 h-12 rounded-xl bg-primary-container/20 flex items-center justify-center text-primary-fixed-dim">
                  <Icon name={step.icon} className="text-[24px]" />
                </div>
                <p className="text-sm text-on-surface font-medium">{step.label}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="py-16 border-t border-white/10">
          <h2 className="font-headline-md text-headline-md text-on-surface text-center mb-2">
            Built like a real teaching process
          </h2>
          <p className="text-center text-on-surface-variant text-sm mb-10 max-w-xl mx-auto">
            Understand → Plan → Explain → Demonstrate → Question → Evaluate → Adapt → Continue — every lesson
            follows the same loop a good human teacher would.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f) => (
              <div key={f.title} className="glass-panel rounded-2xl p-6 glow-hover">
                <div className="w-11 h-11 rounded-xl bg-secondary-container/20 flex items-center justify-center text-secondary mb-4">
                  <Icon name={f.icon} className="text-[22px]" />
                </div>
                <h3 className="font-body-lg text-body-lg text-on-surface font-semibold mb-1.5">{f.title}</h3>
                <p className="text-sm text-on-surface-variant">{f.description}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="py-16 border-t border-white/10">
          <div className="glass-panel rounded-[2rem] p-10 lg:p-14 text-center relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-primary-container/10 via-transparent to-secondary-container/10" />
            <div className="relative z-10">
              <h2 className="font-display-lg text-display-lg-mobile text-on-surface mb-4">
                Your next lesson is one click away.
              </h2>
              <p className="text-on-surface-variant mb-8 max-w-md mx-auto">
                Free to start. No credit card. Just a topic, or a document, and a few minutes.
              </p>
              <Link
                href="/signup"
                className="btn-sheen inline-flex items-center gap-2 px-8 py-4 rounded-full bg-primary-container text-on-primary-container font-semibold relative overflow-hidden shadow-[0_0_24px_rgba(160,120,255,0.3)]"
              >
                Get Started
                <Icon name="arrow_forward" className="text-lg" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 max-w-7xl mx-auto w-full px-6 py-8 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 text-xs text-on-surface-variant">
        <span>© {new Date().getFullYear()} Aetheris AI</span>
        <div className="flex gap-6">
          <Link href="/signin" className="hover:text-on-surface transition-colors">Log in</Link>
          <Link href="/signup" className="hover:text-on-surface transition-colors">Sign up</Link>
        </div>
      </footer>
    </div>
  );
}
