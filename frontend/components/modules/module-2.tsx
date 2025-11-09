"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { ModuleLayout } from "./module-layout"
import { saveModule2Data, getModule2Data, setCurrentModule, requireSessionId } from "@/lib/session-manager"
import type { Module2Output } from "@/lib/pipeline-types"

export function Module2() {
  const router = useRouter()
  const [output, setOutput] = useState<Module2Output | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [redirectCountdown, setRedirectCountdown] = useState<number | null>(null)
  const hasTriggeredRedirectRef = useRef(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const redirectTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sessionIdRef = useRef<string | null>(null)

  const startRedirectCountdown = useCallback(() => {
    console.log('[Module2] Starting redirect countdown from 10 seconds')

    if (redirectTimerRef.current) {
      clearInterval(redirectTimerRef.current)
    }

    setRedirectCountdown(10)

    redirectTimerRef.current = setInterval(() => {
      setRedirectCountdown((prev) => {
        if (prev === null || prev <= 1) {
          if (redirectTimerRef.current) {
            clearInterval(redirectTimerRef.current)
            redirectTimerRef.current = null
          }
          console.log('[Module2] Countdown complete! Redirecting to Module 3')
          router.push('/modules/3')
          return null
        }
        console.log('[Module2] Countdown:', prev - 1)
        return prev - 1
      })
    }, 1000)
  }, [router])

  const cancelRedirect = useCallback(() => {
    if (redirectTimerRef.current) {
      clearInterval(redirectTimerRef.current)
      redirectTimerRef.current = null
    }
    setRedirectCountdown(null)
    console.log('[Module2] Auto-redirect cancelled')
  }, [])

  const loadOutputData = useCallback(async (forcedSessionId?: string) => {
    try {
      setLoading(true)
      setError(null)

      const activeSessionId = forcedSessionId ?? sessionIdRef.current
      if (!activeSessionId) {
        throw new Error('No active pipeline session. Run Module 1 analysis first.')
      }
      const encodedSessionId = encodeURIComponent(activeSessionId)

      const sessionData = getModule2Data()
      const hasSessionData = sessionData?.output !== undefined && sessionData?.output !== null

      const response = await fetch(`/module2/api/output?session_id=${encodedSessionId}`)

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("No classification data available. Please run Module 1 analysis first.")
        }
        if (response.status === 500) {
          setError("Please wait... Processing your request")
          setTimeout(() => {
            void loadOutputData(activeSessionId)
          }, 3000)
          return
        }
        throw new Error("Failed to load classification data")
      }

      const data: Module2Output = await response.json()
      setOutput(data)

      saveModule2Data({ output: data })

      if (!hasSessionData && !hasTriggeredRedirectRef.current) {
        console.log('[Module2] Fresh data from backend, starting countdown to Module 3')
        hasTriggeredRedirectRef.current = true
        startRedirectCountdown()
      } else if (hasSessionData) {
        console.log('[Module2] Backend data loaded, but session exists - user navigated back (no redirect)')
        hasTriggeredRedirectRef.current = true
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data")
    } finally {
      setLoading(false)
    }
  }, [startRedirectCountdown])

  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  useEffect(() => {
    let isMounted = true
    setCurrentModule(2)

    const bootstrap = async () => {
      try {
        const activeSessionId = requireSessionId()
        if (!isMounted) {
          return
        }
        setSessionId(activeSessionId)
        sessionIdRef.current = activeSessionId
        console.log('[Module2] Active session detected:', activeSessionId)
        await loadOutputData(activeSessionId)
      } catch (err) {
        console.error('[Module2] No active session available', err)
        if (isMounted) {
          setError('No active pipeline session. Run Module 1 analysis first.')
          setLoading(false)
        }
      }
    }

    void bootstrap()

    return () => {
      if (redirectTimerRef.current) {
        clearInterval(redirectTimerRef.current)
      }
      isMounted = false
    }
  }, [loadOutputData])

  const getDebatePriorityColor = (priority: string) => {
    switch (priority) {
      case "critical": return "text-red-400 border-red-500/30 bg-red-500/10"
      case "high": return "text-yellow-400 border-yellow-500/30 bg-yellow-500/10"
      case "medium": return "text-blue-400 border-blue-500/30 bg-blue-500/10"
      case "low": return "text-green-400 border-green-500/30 bg-green-500/10"
      default: return "text-gray-400 border-white/10 bg-white/5"
    }
  }

  const getSignificanceColor = (score: number) => {
    if (score >= 80) return "text-red-400"
    if (score >= 60) return "text-yellow-400"
    if (score >= 30) return "text-blue-400"
    return "text-green-400"
  }

  const getCategoryColor = (value: number) => {
    if (value >= 40) return "bg-blue-500/20 border-blue-500/40 text-blue-300"
    if (value >= 20) return "bg-cyan-500/20 border-cyan-500/40 text-cyan-300"
    if (value >= 10) return "bg-teal-500/20 border-teal-500/40 text-teal-300"
    return "bg-white/10 border-white/20 text-white/50"
  }

  return (
    <ModuleLayout
      moduleNumber={2}
      title="Information Classification"
      description="AI-powered classification and significance scoring"
      status="ready"
    >
      <div className="space-y-12">
        {loading && (
          <div className="border border-white/10 rounded p-8">
            <div className="text-white/60 text-center">Loading classification data...</div>
          </div>
        )}

        {error && (
          <div className={`border rounded p-8 ${
            error.includes("Please wait") 
              ? "border-blue-500/30 bg-blue-500/5" 
              : "border-red-500/30 bg-red-500/5"
          }`}>
            <p className={`text-sm ${
              error.includes("Please wait") 
                ? "text-blue-400" 
                : "text-red-400"
            }`}>{error}</p>
            {!error.includes("Please wait") && (
              <p className="text-white/40 text-xs mt-2">
                Run an analysis in Module 1 first, then this module will automatically process it.
              </p>
            )}
            {error.includes("Please wait") && (
              <p className="text-white/40 text-xs mt-2">
                The backend is processing your request. This may take a few moments...
              </p>
            )}
          </div>
        )}

        {output && (
          <>
            {/* Auto-Redirect Notification */}
            {redirectCountdown !== null && (
              <div className="border border-blue-500/30 bg-blue-500/5 rounded p-6 animate-fadeIn">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full border-2 border-blue-500/50 flex items-center justify-center">
                      <span className="text-xl font-light text-blue-400">{redirectCountdown}</span>
                    </div>
                    <div>
                      <p className="text-white/90 text-sm font-medium mb-1">
                        Redirecting to Module 3: Perspective Generation
                      </p>
                      <p className="text-white/50 text-xs">
                        {output.detailed_analysis.requires_debate 
                          ? 'This content requires debate analysis. Module 3 will generate multiple perspectives.'
                          : 'Proceeding to perspective generation for comprehensive analysis.'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={cancelRedirect}
                    className="px-4 py-2 border border-white/20 rounded text-sm text-white/80 hover:bg-white/5 transition-all"
                  >
                    Stay Here
                  </button>
                </div>
              </div>
            )}

            {/* Significance Score */}
            <div className="border border-white/10 rounded p-8">
              <h2 className="text-base font-light text-white/70 mb-6 tracking-wide">
                Significance Score
              </h2>
              
              <div className="space-y-6">
                <div className="flex items-baseline gap-4">
                  <span className={`text-5xl font-bold ${getSignificanceColor(output.detailed_analysis.significance_score)}`}>
                    {output.detailed_analysis.significance_score}
                  </span>
                  <span className="text-white/40 text-sm">/ 100</span>
                </div>

                {/* Significance Bar */}
                <div className="w-full bg-white/5 h-3 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-1000 ${
                      output.detailed_analysis.significance_score >= 80 ? "bg-red-500" :
                      output.detailed_analysis.significance_score >= 60 ? "bg-yellow-500" :
                      output.detailed_analysis.significance_score >= 30 ? "bg-blue-500" : "bg-green-500"
                    }`}
                    style={{ width: `${output.detailed_analysis.significance_score}%` }}
                  />
                </div>

                <div className="border-t border-white/10 pt-4">
                  <p className="text-white/60 text-sm leading-relaxed">
                    {output.detailed_analysis.significance_explanation}
                  </p>
                </div>

                {/* Inverse Relationship Indicator */}
                <div className="bg-white/5 border border-white/10 rounded p-4">
                  <div className="flex items-center justify-between text-xs">
                    <div>
                      <div className="text-white/40 mb-1">Module 1 Confidence</div>
                      <div className="text-white/80 font-medium">
                        {Math.round(output.module1_confidence * 100)}%
                      </div>
                    </div>
                    <div className="text-white/30">←→</div>
                    <div className="text-right">
                      <div className="text-white/40 mb-1">Debate Significance</div>
                      <div className="text-white/80 font-medium">
                        {output.detailed_analysis.significance_score}%
                      </div>
                    </div>
                  </div>
                  <p className="text-white/40 text-xs mt-3">
                    Inverse relationship: Higher confidence = Lower significance (less debate needed)
                  </p>
                </div>
              </div>
            </div>

            {/* Debate Requirement */}
            <div className={`border rounded p-8 ${getDebatePriorityColor(output.detailed_analysis.debate_priority)}`}>
              <h2 className="text-base font-light text-white/70 mb-6 tracking-wide">
                Debate Analysis
              </h2>
              
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="text-2xl">
                    {output.detailed_analysis.requires_debate ? "" : "✓"}
                  </div>
                  <div>
                    <div className="text-white/80 font-medium">
                      {output.detailed_analysis.requires_debate ? "Debate Required" : "Minimal Debate"}
                    </div>
                    <div className="text-sm text-white/60 mt-1">
                      Priority: <span className="font-medium uppercase">{output.detailed_analysis.debate_priority}</span>
                    </div>
                  </div>
                </div>

                <p className="text-white/60 text-sm">
                  {output.detailed_analysis.requires_debate 
                    ? "This content requires multi-perspective debate analysis to determine its true nature."
                    : "This content is straightforward and requires minimal debate analysis."}
                </p>
              </div>
            </div>

            {/* Classification Breakdown */}
            <div className="border border-white/10 rounded p-8">
              <h2 className="text-base font-light text-white/70 mb-6 tracking-wide">
                Verification Classification
              </h2>
              
              <div className="space-y-4">
                {Object.entries(output.detailed_analysis.classification).map(([category, value]) => (
                  <div key={category}>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-white/70 text-sm capitalize">{category}</span>
                      <span className="text-white/50 text-sm">{value.toFixed(1)}%</span>
                    </div>
                    <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-cyan-500 transition-all duration-700"
                        style={{ width: `${value}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 pt-6 border-t border-white/10">
                <div className="text-xs text-white/40 mb-2">AI Classification Reasoning</div>
                <p className="text-white/60 text-sm leading-relaxed">
                  {output.detailed_analysis.classification_reasoning}
                </p>
                <div className="mt-2 text-xs text-white/30">
                  Confidence: {output.detailed_analysis.classification_confidence.toFixed(1)}%
                </div>
              </div>
            </div>

            {/* Category Tags */}
            <div className="border border-white/10 rounded p-8">
              <h3 className="text-base font-light text-white/70 mb-6 tracking-wide">
                Verification Categories
              </h3>
              <div className="flex flex-wrap gap-3">
                {Object.entries(output.detailed_analysis.classification)
                  .filter(([, value]) => value > 5)
                  .sort((a, b) => b[1] - a[1])
                  .map(([category, value]) => (
                    <div
                      key={category}
                      className={`px-4 py-2 border rounded-lg ${getCategoryColor(value)}`}
                    >
                      <div className="text-xs font-medium uppercase">{category}</div>
                      <div className="text-lg font-bold mt-1">{value.toFixed(0)}%</div>
                    </div>
                  ))}
              </div>

              <div className="mt-6 pt-6 border-t border-white/10 space-y-3 text-xs">
                <div>
                  <span className="text-white/40">Person:</span>
                  <span className="text-white/60 ml-2">Requires personal source verification</span>
                </div>
                <div>
                  <span className="text-white/40">Organization:</span>
                  <span className="text-white/60 ml-2">Requires institutional verification</span>
                </div>
                <div>
                  <span className="text-white/40">Social:</span>
                  <span className="text-white/60 ml-2">Requires community/social verification</span>
                </div>
                <div>
                  <span className="text-white/40">Critical:</span>
                  <span className="text-white/60 ml-2">Requires emergency/security verification</span>
                </div>
                <div>
                  <span className="text-white/40">STEM:</span>
                  <span className="text-white/60 ml-2">Can be verified with established facts</span>
                </div>
              </div>
            </div>

            {/* Comprehensive Summary */}
            <div className="border border-white/10 rounded p-8">
              <h2 className="text-base font-light text-white/70 mb-6 tracking-wide">
                Comprehensive Summary
              </h2>
              <p className="text-white/60 leading-relaxed">
                {output.detailed_analysis.comprehensive_summary}
              </p>
            </div>

            {/* Module 1 Context */}
            <div className="border border-white/10 rounded p-8">
              <h3 className="text-base font-light text-white/70 mb-6 tracking-wide">
                Module 1 Analysis Context
              </h3>
              
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="text-xs text-white/40 mb-2">Risk Level</div>
                  <div className="text-white/80 font-medium capitalize">
                    {output.module1_risk_level}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-white/40 mb-2">Confidence</div>
                  <div className="text-white/80 font-medium">
                    {Math.round(output.module1_confidence * 100)}%
                  </div>
                </div>
              </div>

              {output.module1_threats.length > 0 && (
                <div className="mt-6 pt-6 border-t border-white/10">
                  <div className="text-xs text-white/40 mb-3">Detected Threats</div>
                  <div className="flex flex-wrap gap-2">
                    {output.module1_threats.map((threat, idx) => (
                      <span
                        key={idx}
                        className="text-xs px-3 py-1 bg-red-500/10 text-red-400 border border-red-500/20 rounded-full"
                      >
                        {threat.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Timestamp */}
            <div className="text-center text-xs text-white/30">
              Processed: {new Date(output.timestamp).toLocaleString()}
            </div>
          </>
        )}
      </div>
    </ModuleLayout>
  )
}



