import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import Icon from "@/components/Icon";

const STEPS = [
  {
    icon: "upload_file",
    tone: "primary",
    title: "Upload or pick a topic",
    body: "Provide a textbook, PDF, or just a concept you want to learn.",
    offset: "md:mt-0",
  },
  {
    icon: "auto_awesome",
    tone: "secondary",
    title: "AI plans the lesson",
    body: "Structures the content, identifies key concepts, and prepares visuals.",
    offset: "md:mt-8",
  },
  {
    icon: "smart_display",
    tone: "tertiary",
    title: "Teaching video plays",
    body: "Narrates the lesson with a natural voice, avatar, and dynamic diagrams.",
    offset: "md:-mt-4",
  },
  {
    icon: "checklist",
    tone: "primary",
    title: "Adapts to your answers",
    body: "Asks questions, detects misconceptions, and dynamically re-teaches.",
    offset: "md:mt-12",
  },
] as const;

const TONE = {
  primary: { bg: "bg-primary/10", text: "text-primary", line: "from-primary/30" },
  secondary: { bg: "bg-secondary/10", text: "text-secondary", line: "from-secondary/30" },
  tertiary: { bg: "bg-tertiary/10", text: "text-tertiary", line: "from-tertiary/30" },
} as const;

export default async function LandingPage() {
  const session = await auth();
  if (session?.user) redirect("/app");

  return (
    <div className="w-full">
      <header className="fixed top-0 w-full z-50 glass-nav">
        <div className="h-20 w-full px-4 md:px-container-padding flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-3 shrink-0">
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-primary to-secondary flex items-center justify-center shadow-[0_0_20px_rgba(208,188,255,0.3)]">
              <Icon name="auto_awesome" className="text-on-primary" filled />
            </div>
            <span className="font-headline-md text-[18px] sm:text-headline-md text-on-surface tracking-tight whitespace-nowrap">Aetheris AI</span>
          </Link>

          <nav className="hidden md:flex items-center bg-surface-container/40 rounded-full p-1.5 backdrop-blur-md border border-white/5">
            <a
              href="#top"
              className="px-6 py-2 rounded-full font-label-caps text-label-caps bg-primary-container text-on-primary-container shadow-[0_0_15px_rgba(160,120,255,0.2)] transition-all"
            >
              HOME
            </a>
            <a
              href="#how-it-works"
              className="px-6 py-2 rounded-full font-label-caps text-label-caps text-on-surface-variant hover:text-on-surface transition-all"
            >
              HOW IT WORKS
            </a>
            <a
              href="#capabilities"
              className="px-6 py-2 rounded-full font-label-caps text-label-caps text-on-surface-variant hover:text-on-surface transition-all"
            >
              CAPABILITIES
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <Link
              href="/signin"
              className="hidden sm:block px-4 py-2 rounded-full font-label-caps text-label-caps text-on-surface-variant hover:text-on-surface transition-colors whitespace-nowrap"
            >
              LOG IN
            </Link>
            <Link
              href="/signup"
              className="btn-sheen px-5 py-2.5 rounded-full bg-primary text-on-primary font-label-caps text-label-caps relative overflow-hidden whitespace-nowrap shadow-[0_0_20px_rgba(208,188,255,0.3)]"
            >
              GET STARTED
            </Link>
          </div>
        </div>
      </header>

      <main id="top" className="w-full pt-20">
        <div className="flex flex-col w-full relative overflow-hidden">
          {/* Ambient bubbles + grid */}
          <div aria-hidden className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="bubble-bg bubble-1" />
            <div className="bubble-bg bubble-2" />
            <div className="bubble-bg bubble-3" />
            <div className="bubble-bg bubble-4" />
            <div className="grid-overlay absolute inset-0 opacity-30" />
          </div>

          {/* Hero */}
          <section className="relative w-full px-6 md:px-container-padding py-20 md:py-28 flex flex-col md:flex-row items-center justify-between gap-12 max-w-7xl mx-auto z-10">
            <div className="w-full md:w-1/2 flex flex-col items-start gap-8 z-20">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-surface-container-high/50 backdrop-blur-md border border-white/10 shadow-[0_4px_24px_rgba(208,188,255,0.1)]">
                <Icon name="auto_awesome" className="text-primary text-[18px]" filled />
                <span className="font-label-caps text-label-caps text-primary uppercase tracking-wider">
                  Introducing Adaptive AI Teaching
                </span>
              </div>

              <h1 className="font-display-lg text-display-lg-mobile md:text-display-lg text-on-background leading-[1.1]">
                Learn anything,
                <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-secondary to-tertiary">
                  taught like a real class.
                </span>
              </h1>

              <p className="font-body-lg text-body-lg text-on-surface-variant max-w-xl">
                Aetheris AI turns a topic — or your own textbook, notes, or slides — into a personalized video
                lesson: a speaking avatar, subject-aware diagrams, live checkpoint questions, and a real
                assessment at the end. Not a chatbot. An actual teacher.
              </p>

              <div className="flex flex-wrap items-center gap-6 mt-2">
                <Link
                  href="/signup"
                  className="btn-sheen group relative px-8 py-4 rounded-full bg-primary overflow-hidden shadow-[0_0_30px_rgba(208,188,255,0.3)] hover:shadow-[0_0_40px_rgba(208,188,255,0.5)] transition-all duration-300"
                >
                  <span className="relative font-label-caps text-label-caps text-on-primary flex items-center gap-2">
                    GET STARTED
                    <Icon name="arrow_forward" className="text-[18px]" />
                  </span>
                </Link>
                <a
                  href="#how-it-works"
                  className="group flex items-center gap-3 px-6 py-4 rounded-full bg-surface-container-low/50 backdrop-blur-md border border-white/5 hover:bg-white/5 transition-all"
                >
                  <Icon name="play_circle" className="text-secondary group-hover:scale-110 transition-transform" />
                  <span className="font-label-caps text-label-caps text-on-surface">SEE HOW IT WORKS</span>
                </a>
              </div>

              <div className="flex flex-wrap items-center gap-x-8 gap-y-3 mt-4 opacity-70">
                <span className="flex items-center gap-2">
                  <Icon name="translate" className="text-primary text-[20px]" />
                  <span className="font-body-md text-label-caps text-on-surface-variant uppercase">22 languages</span>
                </span>
                <span className="flex items-center gap-2">
                  <Icon name="hub" className="text-secondary text-[20px]" />
                  <span className="font-body-md text-label-caps text-on-surface-variant uppercase">RAG-grounded</span>
                </span>
                <span className="flex items-center gap-2">
                  <Icon name="graphic_eq" className="text-tertiary text-[20px]" />
                  <span className="font-body-md text-label-caps text-on-surface-variant uppercase">Voice + avatar</span>
                </span>
              </div>
            </div>

            {/* Glass lesson-player preview */}
            <div className="w-full md:w-1/2 relative h-[500px] flex items-center justify-center z-10">
              <div className="relative w-full max-w-[480px] aspect-4/5 rounded-[32px] bg-surface-container-low/40 backdrop-blur-2xl border border-white/10 shadow-[0_20px_60px_rgba(0,0,0,0.5)] overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-secondary/10 pointer-events-none" />
                <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />

                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                  <div className="w-40 h-40 rounded-full bg-gradient-to-br from-primary/30 to-secondary/20 backdrop-blur-xl border border-white/10 flex items-center justify-center shadow-[0_0_60px_rgba(208,188,255,0.25)] animate-float">
                    <Icon name="face" className="text-[72px] text-primary" filled />
                  </div>
                  <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest">
                    Your AI teacher
                  </span>
                </div>

                <div className="absolute bottom-6 left-6 right-6 p-4 rounded-2xl bg-surface/60 backdrop-blur-xl border border-white/10 shadow-lg transition-all duration-500 md:translate-y-4 md:opacity-0 md:group-hover:translate-y-0 md:group-hover:opacity-100">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Icon name="quiz" className="text-tertiary" />
                      <span className="font-label-caps text-label-caps text-on-surface">LIVE CHECKPOINT</span>
                    </div>
                    <span className="font-body-md text-[12px] text-on-surface-variant">04:22</span>
                  </div>
                  <p className="font-body-md text-body-md text-on-surface">
                    &ldquo;Can you identify the primary catalyst in this reaction?&rdquo;
                  </p>
                  <div className="h-1 mt-3 bg-primary/20 rounded-full overflow-hidden">
                    <div className="h-full bg-primary w-2/3 shadow-[0_0_10px_rgba(208,188,255,0.8)]" />
                  </div>
                </div>

                <div className="absolute top-6 left-6 px-3 py-1.5 rounded-full bg-surface-container-high/60 backdrop-blur-md border border-white/10 flex items-center gap-2 animate-float">
                  <span className="w-2 h-2 rounded-full bg-error animate-pulse" />
                  <span className="font-label-caps text-[10px] text-on-surface tracking-wider">TEACHING</span>
                </div>
              </div>

              <div className="absolute top-10 right-0 lg:right-10 w-16 h-16 rounded-2xl bg-gradient-to-br from-secondary/30 to-transparent backdrop-blur-xl border border-white/10 flex items-center justify-center shadow-[0_0_30px_rgba(0,162,230,0.2)] animate-float-delayed">
                <Icon name="translate" className="text-secondary" />
              </div>
              <div className="absolute bottom-20 left-0 lg:left-4 w-12 h-12 rounded-full bg-gradient-to-br from-tertiary/30 to-transparent backdrop-blur-xl border border-white/10 flex items-center justify-center shadow-[0_0_30px_rgba(236,106,6,0.2)] animate-float">
                <Icon name="psychology" className="text-tertiary" />
              </div>
            </div>
          </section>

          {/* How it works */}
          <section id="how-it-works" className="relative w-full px-6 md:px-container-padding py-24 max-w-7xl mx-auto z-10">
            <div className="text-center mb-16">
              <h2 className="font-display-lg text-headline-md md:text-[36px] text-on-background mb-4">How it works</h2>
              <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl mx-auto">
                Built like a real teaching process. Every lesson follows the same loop a good human teacher would.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {STEPS.map((step, i) => (
                <div
                  key={step.title}
                  className={`relative p-6 rounded-3xl bg-surface-container/30 backdrop-blur-sm border border-white/5 hover:bg-surface-container/50 transition-colors group ${step.offset}`}
                >
                  <span className="absolute top-0 right-0 p-6 font-display-lg text-[48px] text-on-surface-variant opacity-10">
                    {`0${i + 1}`}
                  </span>
                  <div
                    className={`w-12 h-12 rounded-full ${TONE[step.tone].bg} flex items-center justify-center mb-6 group-hover:scale-110 transition-transform`}
                  >
                    <Icon name={step.icon} className={TONE[step.tone].text} />
                  </div>
                  <h3 className="font-headline-md text-body-lg text-on-surface mb-2">{step.title}</h3>
                  <p className="font-body-md text-sm text-on-surface-variant">{step.body}</p>
                  {i < STEPS.length - 1 && (
                    <div
                      className={`hidden md:block absolute top-1/2 -right-3 w-6 h-px bg-gradient-to-r ${TONE[step.tone].line} to-transparent`}
                    />
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Capabilities bento */}
          <section id="capabilities" className="relative w-full px-6 md:px-container-padding py-24 max-w-7xl mx-auto z-10">
            <h2 className="font-display-lg text-[32px] md:text-[40px] text-on-background mb-12">Key Capabilities</h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:auto-rows-[250px]">
              <div className="md:col-span-2 rounded-3xl bg-surface-container-low border border-white/5 p-8 relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-64 h-64 bg-secondary/10 rounded-full blur-[60px] pointer-events-none" />
                <div className="relative z-10 h-full flex flex-col justify-between md:w-2/3 gap-6">
                  <div className="w-10 h-10 rounded-full bg-secondary/20 flex items-center justify-center backdrop-blur-md">
                    <Icon name="menu_book" className="text-secondary text-[20px]" />
                  </div>
                  <div>
                    <h3 className="font-headline-md text-[24px] text-on-surface mb-2">RAG-Grounded Lessons</h3>
                    <p className="font-body-md text-on-surface-variant">
                      Upload a textbook, PDF, or slide deck and the AI teaches from it directly — retrieval-grounded,
                      not guessed.
                    </p>
                  </div>
                </div>
                <svg
                  aria-hidden
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  className="absolute -right-[20%] -bottom-[20%] w-[60%] h-[120%] opacity-30 group-hover:opacity-50 transition-opacity"
                >
                  <path d="M10,90 Q30,40 50,70 T90,10" fill="none" stroke="#89ceff" strokeDasharray="4 4" strokeWidth="2" />
                  <circle cx="10" cy="90" r="3" fill="#89ceff" />
                  <circle cx="50" cy="70" r="3" fill="#89ceff" />
                  <circle cx="90" cy="10" r="3" fill="#89ceff" />
                </svg>
              </div>

              <div className="rounded-3xl bg-surface-container border border-white/5 p-8 relative overflow-hidden">
                <div className="absolute bottom-0 left-0 w-40 h-40 bg-tertiary/10 rounded-full blur-[40px] pointer-events-none" />
                <div className="relative z-10 h-full flex flex-col justify-between gap-6">
                  <div className="w-10 h-10 rounded-full bg-tertiary/20 flex items-center justify-center backdrop-blur-md">
                    <Icon name="psychology" className="text-tertiary text-[20px]" />
                  </div>
                  <div>
                    <h3 className="font-headline-md text-[20px] text-on-surface mb-2">Misconception Detection</h3>
                    <p className="font-body-md text-sm text-on-surface-variant">
                      Wrong answers get diagnosed. The AI identifies the specific misunderstanding and re-teaches it.
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl bg-surface-container border border-white/5 p-8 relative overflow-hidden group">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-primary/10 rounded-full blur-[30px] pointer-events-none group-hover:scale-150 transition-transform duration-700" />
                <div className="relative z-10 h-full flex flex-col justify-between items-center text-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center backdrop-blur-md shadow-[0_0_20px_rgba(208,188,255,0.2)]">
                    <Icon name="face" className="text-primary text-[24px]" filled />
                  </div>
                  <div>
                    <h3 className="font-headline-md text-[18px] text-on-surface mb-2">Avatar + Natural Voice</h3>
                    <p className="font-body-md text-sm text-on-surface-variant">
                      Narrates every lesson with synced captions and subject-aware visuals.
                    </p>
                  </div>
                </div>
              </div>

              <div className="md:col-span-2 rounded-3xl bg-gradient-to-br from-surface-container-low to-surface-container-highest border border-white/5 p-8 relative overflow-hidden flex flex-row items-center">
                <div className="relative z-10 flex-1 md:pr-8">
                  <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center backdrop-blur-md mb-6">
                    <Icon name="language" className="text-on-surface text-[20px]" />
                  </div>
                  <h3 className="font-headline-md text-[24px] text-on-surface mb-2">22 Languages</h3>
                  <p className="font-body-md text-on-surface-variant">
                    Teach and switch languages mid-lesson — Hindi, Spanish, Tamil, Arabic, and 18 more — without
                    losing lesson context.
                  </p>
                </div>
                <div className="hidden md:flex flex-1 relative h-full items-center justify-center opacity-40">
                  <div className="w-32 h-32 rounded-full border border-white/10 animate-[spin_20s_linear_infinite]" />
                  <div className="absolute w-24 h-24 rounded-full border border-white/20 animate-[spin_15s_linear_infinite_reverse]" />
                  <Icon name="translate" className="absolute text-on-surface text-[48px]" />
                </div>
              </div>
            </div>
          </section>

          {/* CTA */}
          <section className="relative w-full px-6 md:px-container-padding py-24 md:py-32 max-w-4xl mx-auto text-center z-10">
            <div className="absolute inset-0 bg-primary/5 rounded-[40px] blur-[80px] pointer-events-none" />
            <div className="relative z-10 p-8 md:p-12 rounded-[40px] bg-surface-container-lowest/80 backdrop-blur-2xl border border-white/10 shadow-[0_20px_80px_rgba(0,0,0,0.6)]">
              <h2 className="font-display-lg text-[32px] md:text-[56px] text-on-background mb-6 tracking-tight leading-[1.1]">
                Your next lesson is
                <br />
                <span className="italic font-light opacity-80">one click away.</span>
              </h2>
              <p className="font-body-lg text-body-lg text-on-surface-variant max-w-lg mx-auto mb-10">
                Free to start. No credit card. Just a topic, or a document, and a few minutes.
              </p>
              <Link
                href="/signup"
                className="inline-flex items-center gap-3 px-10 py-5 rounded-full bg-gradient-to-r from-tertiary to-tertiary-container shadow-[0_10px_30px_rgba(236,106,6,0.3)] hover:shadow-[0_10px_40px_rgba(236,106,6,0.5)] hover:-translate-y-1 transition-all duration-300"
              >
                <span className="font-label-caps text-[14px] text-on-tertiary-container uppercase font-bold tracking-widest">
                  Start Learning Now
                </span>
                <Icon name="arrow_forward" className="text-on-tertiary-container" />
              </Link>
            </div>
          </section>
        </div>
      </main>

      <footer className="w-full bg-surface-container-lowest py-12 border-t border-white/5">
        <div className="max-w-7xl mx-auto px-6 md:px-container-padding flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-3 opacity-60">
            <Icon name="auto_awesome" className="text-primary" filled />
            <span className="font-headline-md text-body-md text-on-surface">Aetheris AI</span>
          </div>
          <div className="flex gap-8">
            <Link href="/signin" className="text-label-caps font-label-caps text-on-surface-variant hover:text-primary transition-colors">
              LOG IN
            </Link>
            <Link href="/signup" className="text-label-caps font-label-caps text-on-surface-variant hover:text-primary transition-colors">
              SIGN UP
            </Link>
          </div>
          <div className="text-label-caps font-label-caps text-on-surface-variant opacity-40">
            © {new Date().getFullYear()} AETHERIS AI
          </div>
        </div>
      </footer>
    </div>
  );
}
