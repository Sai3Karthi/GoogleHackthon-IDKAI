"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { ModuleLayout } from "./module-layout"
import { LiquidButton } from "../ui/liquid-glass-button"
import { saveFinalAnalysis, setCurrentModule, requireSessionId, clearAllData } from "@/lib/session-manager"

interface Module1Output {
  input_type: string
  risk_level: string
  confidence: number
  threats: string[]
  recommendation: string
  skip_to_final?: boolean
  skip_reason?: string
  ai_reasoning?: string
  scraped_title?: string
  scraped_text?: string
  visual_elements?: string[]
  extracted_text?: string
}

interface Module2Output {
  detailed_analysis?: {
    classification?: {
      person?: number
      organization?: number
      social?: number
      critical?: number
      stem?: number
    }
    classification_reasoning?: string
    classification_confidence?: number
    significance_score?: number
    significance_explanation?: string
    comprehensive_summary?: string
    requires_debate?: boolean
    debate_priority?: string
  }
  module1_confidence?: number
  module1_risk_level?: string
  module1_threats?: string[]
  timestamp?: string
}

interface Module3Perspective {
  text: string
  bias_x: number
  significance_y: number
}

interface Module3Output {
  leftist?: Module3Perspective[]
  rightist?: Module3Perspective[]
  common?: Module3Perspective[]
}

interface Module4TranscriptEntry {
  agent: string
  argument?: string
  message?: string
  round?: number
}

interface Module4Output {
  status?: string
  message?: string
  trust_score?: number
  judgment?: string
  topic?: string
  debate_transcript?: Module4TranscriptEntry[]
  final_verdict?: {
    trust_score?: number
    reasoning?: string
    recommendation?: string
  }
}

interface ComprehensiveAnalysis {
  module1: Module1Output | null
  module2: Module2Output | null
  module3: Module3Output | null
  module4: Module4Output | null
  summary: string
  keyLearnings: string[]
  contentType: string
}

export function Module5() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const source = searchParams?.get("source")
  const skipReason = searchParams?.get("skip_reason")
  
  const [output, setOutput] = useState<Module1Output | null>(null)
  const [comprehensiveAnalysis, setComprehensiveAnalysis] = useState<ComprehensiveAnalysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)

  const appendSessionParam = useCallback((path: string, idOverride?: string) => {
    const activeSession = idOverride ?? sessionIdRef.current
    if (!activeSession) {
      return path
    }

    const encoded = encodeURIComponent(activeSession)
    return path.includes('?')
      ? `${path}&session_id=${encoded}`
      : `${path}?session_id=${encoded}`
  }, [])

  const loadComprehensiveData = useCallback(async (activeSessionId?: string) => {
    try {
      const targetSession = activeSessionId ?? sessionIdRef.current
      if (!targetSession) {
        setError('No active pipeline session. Run Module 1 analysis first.')
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)
      
      const [module1Res, module2Res, module3Res, module4Res] = await Promise.allSettled([
        fetch(appendSessionParam("/module1/api/output", targetSession), { cache: 'no-store' }),
        fetch(appendSessionParam("/module2/api/output", targetSession), { cache: 'no-store' }),
        fetch(appendSessionParam("/module3/api/output", targetSession), { cache: 'no-store' }),
        fetch(appendSessionParam("/module4/api/debate/result", targetSession), { cache: 'no-store' })
      ])
      
      const module1Data = module1Res.status === 'fulfilled' && module1Res.value.ok 
        ? await module1Res.value.json() 
        : null
      const module2Data = module2Res.status === 'fulfilled' && module2Res.value.ok 
        ? await module2Res.value.json() 
        : null
      const module3Data = module3Res.status === 'fulfilled' && module3Res.value.ok 
        ? await module3Res.value.json() 
        : null
      const module4Data = module4Res.status === 'fulfilled' && module4Res.value.ok 
        ? await module4Res.value.json() 
        : null
      
      if (!module1Data) {
        throw new Error("No analysis data available from Module 1")
      }
      
      setOutput(module1Data)
      
      const analysis = generateComprehensiveAnalysis(
        module1Data,
        module2Data,
        module3Data,
        module4Data
      )
      
      setComprehensiveAnalysis(analysis)

      if (module4Data || module1Data?.skip_to_final) {
        saveFinalAnalysis({
          summary: analysis.summary,
          keyLearnings: analysis.keyLearnings,
          contentType: analysis.contentType
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data")
    } finally {
      setLoading(false)
    }
  }, [appendSessionParam])

  useEffect(() => {
    setCurrentModule(5)
    try {
      const activeSessionId = requireSessionId()
      setSessionId(activeSessionId)
    } catch (err) {
      console.error('[Module5] No active session available', err)
      setError('No active pipeline session. Run Module 1 analysis first.')
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    sessionIdRef.current = sessionId
    if (!sessionId) {
      return
    }

    loadComprehensiveData(sessionId)
  }, [sessionId, source, loadComprehensiveData])

  const startNewSession = async () => {
    if (confirm('Start a new session? This will clear all current data and return to Module 1.')) {
      console.log('[Module5] Starting new session - clearing all data')
      await clearAllData()
      
      console.log('[Module5] Redirecting to Module 1')
      router.push('/modules/1')
    }
  }

  const generateComprehensiveAnalysis = (
    m1: Module1Output | null,
    m2: Module2Output | null,
    m3: Module3Output | null,
    m4: Module4Output | null
  ): ComprehensiveAnalysis => {
  const keyLearnings: string[] = []
  let summary = ""
  const contentType = m1?.input_type || "unknown"
    
    // Module 1 Analysis
    if (m1) {
      summary += `This ${contentType} content was analyzed for safety and identified as ${m1.risk_level.toUpperCase()} with ${Math.round(m1.confidence * 100)}% confidence. `
      
      if (m1.threats.length > 0) {
        summary += `Detected threats include: ${m1.threats.join(", ")}. `
        keyLearnings.push(`Be aware of ${m1.threats.length} security threat(s) detected in this content`)
      }
      
      if (m1.risk_level === "dangerous") {
        keyLearnings.push("CRITICAL: This content is malicious. Do not interact with it or share personal information")
      } else if (m1.risk_level === "suspicious") {
        keyLearnings.push("CAUTION: Verify this content through independent sources before trusting it")
      } else {
        keyLearnings.push("This content appears safe, but always maintain healthy skepticism online")
      }
    }
    
    // Module 2 Analysis
    if (m2?.detailed_analysis) {
      const detail = m2.detailed_analysis
      
      if (detail.significance_score !== undefined) {
        summary += `Module 2 assigned a significance score of ${detail.significance_score}/100 (${detail.debate_priority || 'medium'} debate priority). `
        if (detail.requires_debate === true) {
          keyLearnings.push("This topic requires deeper discussion. Pay attention to conflicting claims and seek verified evidence.")
        } else if (detail.requires_debate === false) {
          keyLearnings.push("Module 2 marked this as low debate priority. Still, review the evidence before drawing conclusions.")
        }
      }

      if (detail.comprehensive_summary) {
        summary += `Summary of the content: ${detail.comprehensive_summary.slice(0, 180)}${detail.comprehensive_summary.length > 180 ? '...' : '.'} `
      }

      if (detail.classification_reasoning) {
        keyLearnings.push("Classifier reasoning highlights why this content matters: " + detail.classification_reasoning.slice(0, 140) + (detail.classification_reasoning.length > 140 ? '...' : ''))
      }
    }
    
    // Module 3 Analysis
    if (m3) {
      const totalPerspectives = (m3.leftist?.length || 0) + (m3.rightist?.length || 0) + (m3.common?.length || 0)
      
      if (totalPerspectives > 0) {
        summary += `Bias analysis identified ${totalPerspectives} different perspectives on this content. `
        
        if (m3.leftist && m3.leftist.length > 0) {
          keyLearnings.push(`${m3.leftist.length} left-leaning perspectives were identified in the content`)
        }
        if (m3.rightist && m3.rightist.length > 0) {
          keyLearnings.push(`${m3.rightist.length} right-leaning perspectives were identified in the content`)
        }
        if (m3.common && m3.common.length > 0) {
          keyLearnings.push(`${m3.common.length} politically neutral perspectives were found`)
        }
        
        keyLearnings.push("Understanding bias helps you recognize how content may influence your opinions")
      }
    }
    
    // Module 4 Analysis
    if (m4) {
      const trustScore = m4.trust_score ?? m4.final_verdict?.trust_score
      
      if (trustScore !== undefined) {
        summary += `AI debate analysis resulted in a trust score of ${trustScore}/10. `
        
        if (trustScore >= 7) {
          keyLearnings.push(`High trust score (${trustScore}/10) indicates reliable information with supporting evidence`)
        } else if (trustScore >= 4) {
          keyLearnings.push(`Moderate trust score (${trustScore}/10) suggests mixed evidence. Cross-reference with trusted sources`)
        } else {
          keyLearnings.push(`Low trust score (${trustScore}/10) indicates questionable or unverified claims`)
        }
      }
      
      if (m4.judgment) {
        keyLearnings.push("Judge summary: " + m4.judgment.slice(0, 140) + (m4.judgment.length > 140 ? '...' : ''))
      }
    }
    
    // General learning
    keyLearnings.push("Always verify important information through multiple independent and trusted sources")
    keyLearnings.push("Question the source: Who created this content and what might their motivations be?")
    keyLearnings.push("Check for evidence: Does the content provide verifiable facts or just opinions?")
    
    if (!summary) {
      summary = "Analysis data is being processed. Please ensure all modules have completed their analysis."
    }
    
    const uniqueLearnings = Array.from(new Set(keyLearnings))

    return {
      module1: m1,
      module2: m2,
      module3: m3,
      module4: m4,
      summary,
      keyLearnings: uniqueLearnings,
      contentType
    }
  }

  const getRiskColor = (level: string) => {
    switch (level) {
      case "dangerous": return "text-red-400"
      case "suspicious": return "text-yellow-400"
      case "safe": return "text-green-400"
      default: return "text-gray-400"
    }
  }

  const getRiskBorderColor = (level: string) => {
    switch (level) {
    case "dangerous": return "border-red-500/30 bg-red-500/5"
      case "suspicious": return "border-yellow-500/30 bg-yellow-500/5"
      case "safe": return "border-green-500/30 bg-green-500/5"
      default: return "border-white/10"
    }
  }

  return (
    <ModuleLayout
      moduleNumber={5}
      title="Final Analysis & User Guidance"
      description="What you as a user should know"
      status="ready"
    >
      <div className="space-y-12">
        {/* New Session Button */}
        <div className="flex justify-end">
          <button
            onClick={startNewSession}
            className="px-4 py-2 border border-yellow-500/30 rounded text-sm text-yellow-400 hover:bg-yellow-500/10 transition-all"
          >
             New Session
          </button>
        </div>

        {/* Source Information */}
        {source === "module1" && skipReason && (
          <div className="border border-blue-500/30 bg-blue-500/5 rounded p-8">
            <div className="flex items-center gap-4 mb-4">
              <div className="text-blue-400 text-2xl">⚡</div>
              <div>
                <h3 className="text-base font-light text-blue-400 tracking-wide">
                  Fast-Tracked Analysis
                </h3>
                <p className="text-white/60 text-sm mt-1">{skipReason}</p>
              </div>
            </div>
            <p className="text-white/40 text-xs">
              This content was identified as obviously fake/malicious, skipping debate module.
            </p>
          </div>
        )}

        {loading && (
          <div className="border border-white/10 rounded p-8">
            <div className="text-white/60 text-center">Loading analysis data...</div>
          </div>
        )}

        {error && (
          <div className="border border-red-500/30 bg-red-500/5 rounded p-8">
            <p className="text-red-400 text-sm">{error}</p>
            <p className="text-white/40 text-xs mt-2">
              Please run an analysis in Module 1 first.
            </p>
          </div>
        )}

        {output && comprehensiveAnalysis && (
          <>
            {/* Comprehensive Summary */}
            <div className="border border-purple-500/30 bg-purple-500/5 rounded-lg p-8">
              <h2 className="text-base font-light text-purple-400 mb-6 tracking-wide flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                </svg>
                Complete Analysis Summary
              </h2>
              <p className="text-white/70 text-sm leading-relaxed">
                {comprehensiveAnalysis.summary}
              </p>
            </div>

            {/* Key Learnings */}
            <div className="border border-cyan-500/30 bg-cyan-500/5 rounded-lg p-8">
              <h2 className="text-base font-light text-cyan-400 mb-6 tracking-wide flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path>
                </svg>
                What You Should Learn From This
              </h2>
              <div className="space-y-3">
                {comprehensiveAnalysis.keyLearnings.map((learning, idx) => (
                  <div 
                    key={idx} 
                    className="flex items-start gap-3 p-3 bg-white/5 rounded border border-white/10 hover:border-cyan-500/30 transition-colors"
                  >
                    <div className="w-6 h-6 rounded-full bg-cyan-500/20 border border-cyan-500/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-cyan-400 text-xs font-bold">{idx + 1}</span>
                    </div>
                    <p className="text-white/70 text-sm leading-relaxed flex-1">{learning}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Final Verdict */}
            <div className={`border rounded p-8 ${getRiskBorderColor(output.risk_level)}`}>
              <h2 className="text-base font-light text-white/70 mb-6 tracking-wide">
                Final Verdict
              </h2>
              
              <div className="space-y-6">
                <div className="flex items-baseline gap-4">
                  <span className={`text-4xl font-bold ${getRiskColor(output.risk_level)}`}>
                    {output.risk_level.toUpperCase()}
                  </span>
                  <span className="text-white/40 text-sm">
                    {Math.round(output.confidence * 100)}% confidence
                  </span>
                </div>

                <div className="border-t border-white/10 pt-6">
                  <h3 className="text-white/80 font-medium mb-3">What You Should Know:</h3>
                  <p className="text-white/60 leading-relaxed">
                    {output.recommendation}
                  </p>
                </div>

                {output.threats.length > 0 && (
                  <div className="border-t border-white/10 pt-6">
                    <h3 className="text-white/80 font-medium mb-3">Detected Threats:</h3>
                    <div className="flex flex-wrap gap-2">
                      {output.threats.map((threat, idx) => (
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
            </div>

            {/* Multi-Module Analysis Details */}
            {comprehensiveAnalysis.module2?.detailed_analysis && (
              <div className="border border-white/10 rounded-lg p-8">
                <h2 className="text-base font-light text-white/70 mb-6 tracking-wide">
                  Prioritisation & Classification Insights
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {comprehensiveAnalysis.module2.detailed_analysis.classification && (
                    <div className="border border-white/10 rounded-lg p-4">
                      <div className="text-xs text-white/50 mb-3">Classification Spread</div>
                      <div className="space-y-2 text-xs text-white/60">
                        {Object.entries(comprehensiveAnalysis.module2.detailed_analysis.classification)
                          .filter(([, value]) => typeof value === 'number')
                          .map(([key, value]) => (
                            <div key={key} className="flex items-center gap-3">
                              <span className="w-28 capitalize text-white/70">{key}</span>
                              <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-cyan-500/70"
                                  style={{ width: `${value as number}%` }}
                                ></div>
                              </div>
                              <span className="w-10 text-right">{value}%</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                  <div className="border border-white/10 rounded-lg p-4">
                    <div className="text-xs text-white/50 mb-2">Debate Priority</div>
                    <div className="text-lg font-medium text-white/80 capitalize">
                      {comprehensiveAnalysis.module2.detailed_analysis.debate_priority || 'unknown'}
                    </div>
                    {comprehensiveAnalysis.module2.detailed_analysis.significance_score !== undefined && (
                      <div className="mt-4">
                        <div className="text-xs text-white/50 mb-1">Significance Score</div>
                        <div className="flex items-center gap-3">
                          <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-purple-500/70"
                              style={{ width: `${comprehensiveAnalysis.module2.detailed_analysis.significance_score}%` }}
                            ></div>
                          </div>
                          <span className="text-white/70 text-sm">
                            {comprehensiveAnalysis.module2.detailed_analysis.significance_score}/100
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                {comprehensiveAnalysis.module2.detailed_analysis.comprehensive_summary && (
                  <div className="mt-4 pt-4 border-t border-white/10">
                    <div className="text-xs text-white/50 mb-2">Core Summary</div>
                    <p className="text-white/70 text-sm leading-relaxed">
                      {comprehensiveAnalysis.module2.detailed_analysis.comprehensive_summary}
                    </p>
                  </div>
                )}
                {comprehensiveAnalysis.module2.detailed_analysis.classification_reasoning && (
                  <div className="mt-4 pt-4 border-t border-white/10">
                    <div className="text-xs text-white/50 mb-2">Why this matters</div>
                    <p className="text-white/60 text-sm leading-relaxed">
                      {comprehensiveAnalysis.module2.detailed_analysis.classification_reasoning}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Perspective Analysis */}
            {comprehensiveAnalysis.module3 && (
              <div className="border border-white/10 rounded-lg p-8">
                <h2 className="text-base font-light text-white/70 mb-6 tracking-wide">
                  Bias & Perspective Analysis
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {comprehensiveAnalysis.module3.leftist && comprehensiveAnalysis.module3.leftist.length > 0 && (
                    <div className="border border-red-500/30 bg-red-500/5 rounded-lg p-4">
                      <div className="text-xs text-red-400 mb-2">Left-Leaning Views</div>
                      <div className="text-2xl font-bold text-red-400">
                        {comprehensiveAnalysis.module3.leftist.length}
                      </div>
                      <div className="text-xs text-white/50 mt-1">perspectives identified</div>
                    </div>
                  )}
                  {comprehensiveAnalysis.module3.rightist && comprehensiveAnalysis.module3.rightist.length > 0 && (
                    <div className="border border-blue-500/30 bg-blue-500/5 rounded-lg p-4">
                      <div className="text-xs text-blue-400 mb-2">Right-Leaning Views</div>
                      <div className="text-2xl font-bold text-blue-400">
                        {comprehensiveAnalysis.module3.rightist.length}
                      </div>
                      <div className="text-xs text-white/50 mt-1">perspectives identified</div>
                    </div>
                  )}
                  {comprehensiveAnalysis.module3.common && comprehensiveAnalysis.module3.common.length > 0 && (
                    <div className="border border-green-500/30 bg-green-500/5 rounded-lg p-4">
                      <div className="text-xs text-green-400 mb-2">Neutral Views</div>
                      <div className="text-2xl font-bold text-green-400">
                        {comprehensiveAnalysis.module3.common.length}
                      </div>
                      <div className="text-xs text-white/50 mt-1">perspectives identified</div>
                    </div>
                  )}
                </div>
                <div className="mt-4 pt-4 border-t border-white/10">
                  <p className="text-white/60 text-xs">
                    Understanding different perspectives helps you recognize potential bias and form more balanced opinions.
                  </p>
                </div>
              </div>
            )}

            {/* Debate Trust Score */}
            {comprehensiveAnalysis.module4 && (
              comprehensiveAnalysis.module4.trust_score !== undefined ||
              comprehensiveAnalysis.module4.final_verdict?.trust_score !== undefined ||
              !!comprehensiveAnalysis.module4.judgment
            ) && (
              <div className="border border-white/10 rounded-lg p-8">
                <h2 className="text-base font-light text-white/70 mb-6 tracking-wide">
                  AI Debate Trust Assessment
                </h2>
                <div className="flex items-center gap-6 mb-4">
                  <div className="flex-shrink-0">
                    <div className="text-xs text-white/50 mb-2">Trust Score</div>
                    <div className="text-4xl font-bold text-purple-400">
                      {comprehensiveAnalysis.module4.trust_score || comprehensiveAnalysis.module4.final_verdict?.trust_score || 'N/A'}
                      {(comprehensiveAnalysis.module4.trust_score || comprehensiveAnalysis.module4.final_verdict?.trust_score) && '/10'}
                    </div>
                  </div>
                  <div className="flex-1">
                    {comprehensiveAnalysis.module4.final_verdict?.reasoning && (
                      <p className="text-white/70 text-sm leading-relaxed">
                        {comprehensiveAnalysis.module4.final_verdict.reasoning}
                      </p>
                    )}
                    {comprehensiveAnalysis.module4.judgment && (
                      <p className="text-white/70 text-sm leading-relaxed">
                        {comprehensiveAnalysis.module4.judgment}
                      </p>
                    )}
                  </div>
                </div>
                <div className="pt-4 border-t border-white/10">
                  <p className="text-white/60 text-xs">
                    AI agents debated this content from multiple perspectives with web-verified evidence to assess trustworthiness.
                  </p>
                </div>
              </div>
            )}

            {/* Detailed Analysis */}
            {output.ai_reasoning && (
              <div className="border border-white/10 rounded p-8">
                <h2 className="text-base font-light text-white/70 mb-6 tracking-wide">
                  Initial Security Analysis
                </h2>
                <p className="text-white/60 text-sm leading-relaxed whitespace-pre-wrap">
                  {output.ai_reasoning}
                </p>
              </div>
            )}

            {/* Image Analysis */}
            {output.input_type === "image" && (
              <>
                {output.visual_elements && output.visual_elements.length > 0 && (
                  <div className="border border-white/10 rounded p-8">
                    <h2 className="text-base font-light text-white/70 mb-6 tracking-wide">
                      Visual Threats Detected
                    </h2>
                    <div className="flex flex-wrap gap-2">
                      {output.visual_elements.map((element, idx) => (
                        <span
                          key={idx}
                          className="text-xs px-3 py-1 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-full"
                        >
                          {element.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {output.extracted_text && (
                  <div className="border border-white/10 rounded p-8">
                    <h2 className="text-base font-light text-white/70 mb-6 tracking-wide">
                      Text Found in Image
                    </h2>
                    <p className="text-white/60 text-sm leading-relaxed font-mono whitespace-pre-wrap">
                      {output.extracted_text}
                    </p>
                  </div>
                )}
              </>
            )}

            {/* Content Preview */}
            {output.scraped_title && (
              <div className="border border-white/10 rounded p-8">
                <h2 className="text-base font-light text-white/70 mb-6 tracking-wide">
                  Content Analyzed
                </h2>
                <div className="space-y-3">
                  <div>
                    <div className="text-white/40 text-xs mb-1">Title:</div>
                    <div className="text-white/80 text-sm">{output.scraped_title}</div>
                  </div>
                  {output.scraped_text && (
                    <div>
                      <div className="text-white/40 text-xs mb-1">Content Preview:</div>
                      <div className="text-white/60 text-sm leading-relaxed">
                        {output.scraped_text.substring(0, 300)}...
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Action Recommendations */}
            <div className="border border-white/10 rounded p-8">
              <h2 className="text-base font-light text-white/70 mb-6 tracking-wide">
                Recommended Actions
              </h2>
              <div className="space-y-4">
                {output.risk_level === "dangerous" && (
                  <div className="flex items-start gap-3">
                    <span className="text-red-400 text-xl">🛑</span>
                    <div>
                      <div className="text-white/80 font-medium mb-1">Do Not Proceed</div>
                      <div className="text-white/60 text-sm">
                        This content has been identified as malicious or fake. Do not click links, 
                        download files, or share personal information.
                      </div>
                    </div>
                  </div>
                )}
                
                {output.risk_level === "suspicious" && (
                  <div className="flex items-start gap-3">
                    <span className="text-yellow-400 text-xl">⚠️</span>
                    <div>
                      <div className="text-white/80 font-medium mb-1">Proceed with Caution</div>
                      <div className="text-white/60 text-sm">
                        This content shows warning signs. Verify the source independently before 
                        taking any action.
                      </div>
                    </div>
                  </div>
                )}

                {output.risk_level === "safe" && (
                  <div className="flex items-start gap-3">
                    <span className="text-green-400 text-xl">✅</span>
                    <div>
                      <div className="text-white/80 font-medium mb-1">Appears Safe</div>
                      <div className="text-white/60 text-sm">
                        No major threats detected. However, always exercise caution online.
                      </div>
                    </div>
                  </div>
                )}

                <div className="border-t border-white/10 pt-4 mt-6">
                  <div className="text-white/40 text-xs mb-2">General Tips:</div>
                  <ul className="text-white/60 text-sm space-y-2">
                    <li>• Verify information through multiple trusted sources</li>
                    <li>• Check URLs carefully before clicking</li>
                    <li>• Never share sensitive information via unverified channels</li>
                    <li>• When in doubt, consult with experts or authorities</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-4">
              <LiquidButton
                onClick={() => window.location.href = "/modules/1"}
                className="flex-1"
              >
                Analyze New Content
              </LiquidButton>
              <button
                onClick={() => window.location.href = "/"}
                className="px-6 py-2 border border-white/10 text-white/60 hover:text-white/90 hover:border-white/30 rounded transition-all text-sm"
              >
                Back to Home
              </button>
            </div>
          </>
        )}
      </div>
    </ModuleLayout>
  )
}
