"use client"

import { useEffect, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { ModuleLayout } from "./module-layout"
import { LiquidButton } from "../ui/liquid-glass-button"

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

export function Module5() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const source = searchParams?.get("source")
  const skipReason = searchParams?.get("skip_reason")
  
  const [output, setOutput] = useState<Module1Output | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadOutputData()
  }, [])

  const startNewSession = () => {
    if (confirm('Start a new session? This will clear all current data and return to Module 1.')) {
      console.log('[Module5] Starting new session - clearing all data')
      // Clear session storage
      if (typeof window !== 'undefined') {
        const { clearSession } = require('@/lib/session-manager')
        clearSession()
      }
      // Redirect to Module 1
      console.log('[Module5] Redirecting to Module 1')
      router.push('/modules/1')
    }
  }

  const loadOutputData = async () => {
    try {
      setLoading(true)
      const response = await fetch("/module1/api/output")
      
      if (!response.ok) {
        throw new Error("No analysis data available")
      }
      
      const data = await response.json()
      setOutput(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data")
    } finally {
      setLoading(false)
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

        {output && (
          <>
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

            {/* Detailed Analysis */}
            {output.ai_reasoning && (
              <div className="border border-white/10 rounded p-8">
                <h2 className="text-base font-light text-white/70 mb-6 tracking-wide">
                  AI Analysis
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
