"use client"

import { ReactNode, useEffect } from "react"
import { useRouter } from "next/navigation"

interface ModuleLayoutProps {
  children: ReactNode
  moduleNumber: number
  title: string
  description: string
  status?: "progress" | "ready" | "error"
}

export function ModuleLayout({ 
  children, 
  moduleNumber, 
  title, 
  description,
  status = "ready" 
}: ModuleLayoutProps) {
  const router = useRouter()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && moduleNumber > 1) {
        router.replace(`/modules/${moduleNumber - 1}`)
      } else if (e.key === "ArrowRight" && moduleNumber < 5) {
        router.replace(`/modules/${moduleNumber + 1}`)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [moduleNumber, router])

  return (
    <div className="fixed inset-0 w-screen h-screen overflow-hidden bg-black">
      <div className="relative z-10 h-full flex flex-col">
        {/* Minimal Header */}
        <header className="border-b border-white/10 bg-black/60 backdrop-blur-sm">
          <div className="max-w-6xl mx-auto px-8 py-5">
            <div className="flex items-center justify-between">
              {/* Left: Module info */}
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-lg border border-white/20 flex items-center justify-center text-white text-xl font-light">
                  {moduleNumber}
                </div>
                
                <div>
                  <div className="flex items-center gap-3">
                    <h1 className="text-xl font-light text-white tracking-wide">
                      {title}
                    </h1>
                    {status === "progress" && (
                      <span className="px-2 py-0.5 bg-yellow-500/10 border border-yellow-500/30 rounded text-yellow-400 text-xs">
                        In Progress
                      </span>
                    )}
                    {status === "error" && (
                      <span className="px-2 py-0.5 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-xs">
                        Action Required
                      </span>
                    )}
                  </div>
                  <p className="text-white/50 text-xs mt-0.5">{description}</p>
                </div>
              </div>

              {/* Right: Nav */}
              <div className="flex items-center gap-4">
                {/* Module tabs */}
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((num) => (
                    <button
                      key={num}
                      onClick={() => router.replace(`/modules/${num}`)}
                      className={`w-8 h-8 rounded text-sm transition-all ${
                        num === moduleNumber 
                          ? 'bg-white/20 text-white border border-white/30' 
                          : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                      }`}
                    >
                      {num}
                    </button>
                  ))}
                </div>

                {/* Home button */}
                <button
                  onClick={() => router.push("/")}
                  className="text-white/50 hover:text-white text-xs transition-colors"
                >
                  Home
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-8 py-12">
            {children}
          </div>
        </main>

        {/* Minimal Footer */}
        <footer className="border-t border-white/10 bg-black/60 backdrop-blur-sm">
          <div className="max-w-6xl mx-auto px-8 py-4">
            <div className="flex items-center justify-between">
              <button
                onClick={() => {
                  if (moduleNumber > 1) {
                    router.replace(`/modules/${moduleNumber - 1}`)
                  } else {
                    router.push("/")
                  }
                }}
                className="flex items-center gap-2 text-white/60 hover:text-white text-sm transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                <span>{moduleNumber > 1 ? "Previous" : "Home"}</span>
              </button>

              {/* Progress dots */}
              <div className="flex items-center gap-1.5">
                {[1, 2, 3, 4, 5].map((num) => (
                  <div
                    key={num}
                    className={`h-1.5 rounded-full transition-all ${
                      num === moduleNumber 
                        ? 'w-6 bg-white' 
                        : 'w-1.5 bg-white/20'
                    }`}
                  />
                ))}
              </div>

              <button
                onClick={() => moduleNumber < 5 && router.replace(`/modules/${moduleNumber + 1}`)}
                disabled={moduleNumber === 5}
                className="flex items-center gap-2 text-white/60 hover:text-white text-sm transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <span>Next</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}

