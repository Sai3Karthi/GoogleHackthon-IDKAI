"use client"

import { WebGLShader } from "@/components/ui/web-gl-shader"
import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"

export default function LandingPage() {
  const router = useRouter()
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const heroContentRef = useRef<HTMLDivElement>(null)
  const animationFrameRef = useRef<number | null>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault()
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollBy({ top: window.innerHeight, behavior: 'smooth' })
        }
      }
    }

      let scrollTimeout: NodeJS.Timeout | null = null
      let lastScrollTime = 0

      const handleScroll = () => {
        const currentTime = Date.now()

        // Throttle scroll updates to 60fps max
        if (currentTime - lastScrollTime >= 16) { // ~60fps
          if (scrollContainerRef.current && heroContentRef.current) {
            const scrollTop = scrollContainerRef.current.scrollTop
            const scrollHeight = scrollContainerRef.current.scrollHeight - scrollContainerRef.current.clientHeight
            const progress = Math.min(scrollTop / scrollHeight, 1)

            // Update transform and opacity directly via CSS for better performance
            const translateY = progress * 50
            const opacity = Math.max(0, 1 - progress * 2)

            heroContentRef.current.style.transform = `translateY(${translateY}px)`
            heroContentRef.current.style.opacity = String(opacity)
          }
          lastScrollTime = currentTime
        }

        // Clear previous timeout
        if (scrollTimeout) {
          clearTimeout(scrollTimeout)
        }

        // Set a final update after scroll stops for precision
        scrollTimeout = setTimeout(() => {
          if (scrollContainerRef.current && heroContentRef.current) {
            const scrollTop = scrollContainerRef.current.scrollTop
            const scrollHeight = scrollContainerRef.current.scrollHeight - scrollContainerRef.current.clientHeight
            const progress = Math.min(scrollTop / scrollHeight, 1)

            const translateY = progress * 50
            const opacity = Math.max(0, 1 - progress * 2)

            heroContentRef.current.style.transform = `translateY(${translateY}px)`
            heroContentRef.current.style.opacity = String(opacity)
          }
        }, 100)
      }

    const container = scrollContainerRef.current
    container?.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener("keydown", handleKeyDown)
    
      return () => {
        if (scrollTimeout) {
          clearTimeout(scrollTimeout)
        }
        container?.removeEventListener('scroll', handleScroll)
        window.removeEventListener("keydown", handleKeyDown)
      }
  }, [])

  const handleTestItOut = () => {
    router.push("/modules/1")
  }

  return (
    <div className="fixed inset-0 w-screen h-screen overflow-hidden">
      {/* Fixed background */}
      <div className="fixed inset-0 w-screen h-screen">
        <WebGLShader />
      </div>

      {/* Gradient overlays for depth */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/40 to-black/80" />
      </div>

      {/* Scrollable content */}
      <div
        ref={scrollContainerRef}
        className="relative z-10 w-screen h-screen overflow-y-scroll hide-scrollbar scroll-optimized snap-y snap-mandatory"
        style={{ scrollBehavior: 'smooth', WebkitOverflowScrolling: 'touch' }}
      >
        {/* Hero Section */}
        <section className="min-h-screen w-screen flex flex-col items-center justify-center relative snap-start">
          <div className="w-full flex justify-center">
            <div
              ref={heroContentRef}
              className="grid w-full max-w-6xl grid-cols-12 gap-y-8 gap-x-6 px-6 md:px-10 will-change-transform"
            >
              {/* Quote */}
              <div className="col-span-12 md:col-start-2 md:col-span-5">
                <p className="text-left text-lg md:text-xl text-white/60 tracking-wide font-mono" style={{ fontFamily: 'monospace', letterSpacing: '0.12em' }}>
                  paste. sitback. relax.
                </p>
              </div>

              {/* Logo/Brand */}
              <div className="col-span-12 md:col-start-2 md:col-span-8 relative -mt-6">
                <div className="absolute inset-0 blur-3xl bg-white/10 opacity-20 will-change-opacity" style={{ animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' }} />
                <h1 className="relative text-left text-7xl md:text-8xl lg:text-9xl font-extralight text-white font-mono flex gap-1 animate-glow-pulse">
                  <span className="inline-block animate-text-reveal letter-delay-1 animate-letter-flicker">I</span>
                  <span className="inline-block animate-text-reveal letter-delay-2 animate-letter-flicker">D</span>
                  <span className="inline-block animate-text-reveal letter-delay-3 animate-letter-flicker">K</span>
                  <span className="inline-block animate-text-reveal letter-delay-4">-</span>
                  <span className="inline-block animate-text-reveal letter-delay-5 animate-letter-flicker">A</span>
                  <span className="inline-block animate-text-reveal letter-delay-6 animate-letter-flicker">I</span>
                </h1>
              </div>

              {/* Subtitle */}
              <div className="col-span-12 md:col-start-2 md:col-span-6">
                <p className="text-left text-3xl md:text-5xl font-light text-white/90 tracking-wide font-mono" style={{ fontFamily: 'monospace', letterSpacing: '0.1em' }}>
                  I Do <span className="text-white">Know</span>
                </p>
              </div>

              {/* Description */}
              <div className="col-span-12 md:col-start-2 md:col-span-8">
                <div className="relative group">
                  <div className="absolute -inset-1 bg-white/10 rounded-2xl blur opacity-20 group-hover:opacity-30 transition duration-500" />
                  <div className="relative px-8 py-6 bg-black/30 backdrop-blur-optimized border border-white/20 rounded-2xl text-left">
                    <p className="text-lg md:text-2xl text-white/80 leading-relaxed">
                      Advanced misinformation tracking through sophisticated multi-perspective AI analysis
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Scroll indicator and CTA */}
          <div className="absolute bottom-10 left-0 right-0">
            <div className="flex items-center justify-between gap-8 w-full max-w-6xl mx-auto px-6 md:px-10">
              <div className="flex flex-col items-start gap-3">
                <span className="text-base text-white/40 tracking-widest uppercase">Discover More</span>
                <div className="w-7 h-12 rounded-full border-2 border-white/20 flex items-start justify-center p-2">
                  <div className="w-1 h-3 bg-white/40 rounded-full animate-bounce" />
                </div>
              </div>
              <button
                onClick={handleTestItOut}
                className="group relative px-8 py-4 overflow-hidden rounded-xl border border-white/30 bg-black/40 hover:bg-black/20 transition-all duration-300"
              >
                <span className="relative text-white font-medium text-lg">Experience Module 3</span>
              </button>
            </div>
          </div>
        </section>

        {/* Narrative Section */}
        <section className="min-h-[70vh] w-screen flex flex-col items-center justify-center py-24 snap-start">
          <div className="w-full max-w-6xl grid grid-cols-12 gap-y-10 gap-x-6 px-6 md:px-10">
            <div className="col-span-12 md:col-start-2 md:col-span-9">
              <div className="relative overflow-hidden rounded-2xl border border-white/15 bg-black/40 backdrop-blur-lg p-10">
                <div
                  className="absolute -inset-32 pointer-events-none"
                  style={{
                    background: 'radial-gradient(circle at 30% 40%, rgba(255,255,255,0.18), transparent 60%)',
                    animation: 'slowGlow 8s ease-in-out infinite'
                  }}
                />
                <div className="relative space-y-6" style={{ animation: 'fadeInUp 0.8s ease forwards' }}>
                  <h2 className="text-left text-4xl md:text-5xl font-light text-white leading-tight">
                    See the Whole Picture, Not Just One Side.
                  </h2>
                  <p className="text-base md:text-lg text-white/75 leading-relaxed max-w-3xl">
                    Tired of biased news and hidden agendas? Our AI digs deeper, showing you how any piece of information can be seen from multiple angles. Make up your own mind, with all the facts.
                  </p>
                  <p className="text-sm md:text-base text-white/50 font-mono tracking-[0.25em] uppercase" style={{ animation: 'fadeInUp 0.9s ease forwards', animationDelay: '0.15s' }}>
                    "paste it. sit back. relax. learn"
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Problem Section */}
        <section className="min-h-screen w-screen flex flex-col items-center justify-center py-24 snap-start">
          <div className="w-full max-w-6xl grid grid-cols-12 gap-y-10 gap-x-6 px-6 md:px-10">
            <div className="col-span-12 md:col-start-2 md:col-span-8 space-y-6 text-left">
              <h2 className="text-4xl md:text-5xl font-light text-white tracking-tight font-mono" style={{ fontFamily: 'monospace', letterSpacing: '0.1em' }}>The Information Crisis</h2>
              <div className="relative bg-black/40 border border-white/10 rounded-2xl p-6">
                <div className="dot-matrix-faint dot-matrix-overlay opacity-30 rounded-2xl" />
                <p className="text-base md:text-lg text-white/70 leading-relaxed">
                  Mis-Dis-Rm information and deepfake ads are flooding the internet, causing financial losses up to 3.5 Cr and public/online distress, biases and manipulations.
                  Wanna see your favorite video? Nope—here's a news article that claims Ronaldo uses fishywebsite.com to generate a second income. We've had enough.
                </p>
              </div>
            </div>

            <div className="col-span-12 md:col-start-2 md:col-span-7 relative bg-black/40 border border-white/10 rounded-2xl p-6">
              <div className="dot-matrix-light dot-matrix-overlay opacity-20 rounded-2xl" />
              <h3 className="text-2xl md:text-3xl font-light text-white mb-3 font-mono" style={{ fontFamily: 'monospace', letterSpacing: '0.08em' }}>The Fundamental Question</h3>
              <p className="text-base md:text-lg text-white/70 leading-relaxed">
                Currently no information can be classified as real, biased, or even manipulative with just AI—we still need people to make the ultimate decision.
                We come to question: <span className="text-white">“What if the source of truth itself is biased?”</span>
              </p>
            </div>
          </div>
        </section>

        {/* Approach Section */}
        <section className="min-h-screen w-screen flex flex-col items-center justify-center py-24 snap-start">
          <div className="w-full max-w-6xl grid grid-cols-12 gap-y-10 gap-x-6 px-6 md:px-10">
            <div className="col-span-12 md:col-start-2 md:col-span-9 space-y-4 text-left">
              <h2 className="text-4xl md:text-5xl font-light text-white tracking-tight font-mono" style={{ fontFamily: 'monospace', letterSpacing: '0.1em' }}>We see every information as a spectrum of thoughts</h2>
              <div className="relative bg-black/40 border border-white/10 rounded-2xl p-6">
                <div className="dot-matrix-faint dot-matrix-overlay opacity-30 rounded-2xl" />
                <p className="text-base md:text-lg text-white/70 leading-relaxed">
                  Instead of looking only at the source, we look at the history of each and every part of the information—from all points of view. This lets us use AI to do the heavy lifting without human intervention.
                </p>
              </div>
            </div>

            <div className="col-span-12 md:col-start-2 md:col-span-9 grid grid-cols-1 md:grid-cols-2 gap-6">
              {[{
                n: '01',
                t: 'Analysis',
                d: "We analyse inputs using techniques to scan links and detect deepfakes. It's a big step forward—but it doesn't end here.",
              },{
                n: '02',
                t: 'Documentation & Scoring',
                d: 'If links are safe and content requires analysis, we automatically create documentation with scores that determine depth. Non-provable content moves to the next phase.',
              },{
                n: '03',
                t: 'Perspective Generation',
                d: 'A well-trained LLM generates up to 512 unique perspectives—ways different people may view the information—each with a significance score.',
              },{
                n: '04',
                t: 'ML Cleaning',
                d: 'We use ML algorithms like Top-N KNN to clean and select the best perspectives for analysis.',
              }].map((s, i) => (
                <div key={i} className="relative bg-black/40 border border-white/10 rounded-2xl p-7">
                  <div className="dot-matrix-faint dot-matrix-overlay opacity-20 rounded-2xl" />
                  <div className="flex items-start gap-4">
                    <div className="w-9 h-9 rounded-full border border-white/30 text-white/80 text-sm flex items-center justify-center mt-0.5">{s.n}</div>
                    <div>
                      <h4 className="text-white font-light mb-2 text-lg">{s.t}</h4>
                      <p className="text-sm md:text-base text-white/70 leading-relaxed">{s.d}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Agents Section */}
        <section className="min-h-screen w-screen flex flex-col items-center justify-center py-24 snap-start">
          <div className="w-full max-w-6xl grid grid-cols-12 gap-y-10 gap-x-6 px-6 md:px-10">
            <div className="col-span-12 md:col-start-2 md:col-span-8 relative bg-black/40 border border-white/10 rounded-2xl p-6 text-left">
              <div className="dot-matrix-light dot-matrix-overlay opacity-20 rounded-2xl" />
              <h3 className="text-2xl md:text-3xl font-light text-white mb-3 font-mono" style={{ fontFamily: 'monospace', letterSpacing: '0.08em' }}>Agent Debate</h3>
              <p className="text-base md:text-lg text-white/70 leading-relaxed">
                We call this a spectrum of perspectives. The information and documentation then feed advanced agents developed with Vertex AI.
                Two agents—Leftist and Rightist—debate the strongest perspectives with at least one common baseline to avoid debate folly.
              </p>
              <p className="text-sm md:text-base text-white/50 leading-relaxed mt-4">
                Vector DB and extended reasoning components are being integrated.
              </p>
            </div>

            <div className="col-span-12 md:col-start-2 md:col-span-8 relative bg-black/40 border border-white/10 rounded-2xl p-6 text-left">
              <div className="dot-matrix-faint dot-matrix-overlay opacity-20 rounded-2xl" />
              <h3 className="text-2xl md:text-3xl font-light text-white mb-3 font-mono" style={{ fontFamily: 'monospace', letterSpacing: '0.08em' }}>Future Agents</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-black/30 border border-white/20 rounded-xl p-4">
                  <div className="text-white font-medium mb-1">The Sourcer</div>
                  <p className="text-sm md:text-base text-white/60 leading-relaxed">
                    Scans the history and credibility of sources to tackle "right information, untrustable source."
                  </p>
                </div>
                <div className="bg-black/30 border border-white/20 rounded-xl p-4">
                  <div className="text-white font-medium mb-1">The Judge</div>
                  <p className="text-sm md:text-base text-white/60 leading-relaxed">
                    Improves the debate mechanism by assigning scores to agents.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Impact Section */}
        <section className="min-h-screen w-screen flex flex-col items-center justify-center py-24 snap-start">
          <div className="w-full max-w-6xl grid grid-cols-12 gap-y-10 gap-x-6 px-6 md:px-10">
            <div className="col-span-12 md:col-start-2 md:col-span-8 space-y-4 text-left">
              <h2 className="text-4xl md:text-5xl font-light text-white tracking-tight font-mono" style={{ fontFamily: 'monospace', letterSpacing: '0.1em' }}>The Result</h2>
              <p className="text-base md:text-lg text-white/70 leading-relaxed max-w-3xl">
                Users and organizations receive a concise report—what the information intends, how to view it, why, what backs it, and what to do to avoid traps. It also educates users on identifying and tackling cyber attacks, manipulations, and misinformation.
              </p>
            </div>

            <div className="col-span-12 md:col-start-2 md:col-span-7 relative bg-black/40 border border-white/10 rounded-2xl p-8 text-left">
              <div className="dot-matrix-faint dot-matrix-overlay opacity-20 rounded-2xl" />
              <h3 className="text-2xl md:text-3xl font-light text-white mb-3 font-mono" style={{ fontFamily: 'monospace', letterSpacing: '0.08em' }}>Our Mission</h3>
              <p className="text-base md:text-lg text-white/70 leading-relaxed">
                We believe this solution uniquely tackles what current AI-based trackers fail to do—and we are determined to bring change.
              </p>
            </div>
          </div>
        </section>
      </div>

      <style jsx>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes slowGlow {
          0% {
            opacity: 0.2;
            transform: translateX(-5%);
          }
          50% {
            opacity: 0.45;
            transform: translateX(5%);
          }
          100% {
            opacity: 0.2;
            transform: translateX(-5%);
          }
        }
      `}</style>
    </div>
  )
}

