"use client"

import { useState } from "react"
import { ModuleLayout } from "./module-layout"
import { LiquidButton } from "../ui/liquid-glass-button"

interface AnalysisResult {
  input_type: string
  risk_level: string
  confidence: number
  threats: string[]
  analysis: {
    red_flags?: string[]
    ai_explanation?: string
    ai_reasoning?: string
    scam_keywords_found?: number
    phishing_patterns_found?: number
    text_length?: number
  }
  recommendation: string
  scraped_content?: {
    title: string
    text: string
  } | null
  ai_powered: boolean
}

export function Module1() {
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const analyzeContent = async () => {
    if (!input.trim()) {
      setError("Please enter a URL or text to analyze")
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch("/module1/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: input.trim() }),
      })

      if (!response.ok) {
        throw new Error(`Analysis failed: ${response.statusText}`)
      }

      const data: AnalysisResult = await response.json()
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed")
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

  return (
    <ModuleLayout
      moduleNumber={1}
      title="Link/Text Verification"
      description="Powered by Google Gemini AI for scam and fraud detection"
      status="progress"
    >
      <div className="space-y-12">
        {/* Input Section */}
        <div className="border border-white/10 rounded p-8">
          <h2 className="text-base font-light text-white/70 mb-6 tracking-wide">Analyze Content</h2>
          
          <div className="space-y-4">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Enter URL or paste suspicious text here..."
              className="w-full h-32 bg-black/30 text-white/90 rounded border border-white/10 p-4 focus:border-white/30 focus:outline-none resize-none font-mono text-sm"
              disabled={loading}
            />
            
            <div className="flex gap-4">
              <LiquidButton
                onClick={analyzeContent}
                disabled={loading || !input.trim()}
                className="flex-1"
              >
                {loading ? "Analyzing with AI..." : "Analyze Content"}
              </LiquidButton>
              
              {(result || error) && (
                <button
                  onClick={() => { setInput(""); setResult(null); setError(null); }}
                  className="px-6 py-2 border border-white/10 text-white/60 hover:text-white/90 hover:border-white/30 rounded transition-all text-sm"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="mt-4 border border-red-500/30 bg-red-500/5 rounded p-4">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}
        </div>

        {/* Results */}
        {result && (
          <>
            {/* Risk Assessment */}
            <div className="border border-white/10 rounded p-8">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-base font-light text-white/70 tracking-wide">Risk Assessment</h3>
                {result.ai_powered && (
                  <span className="text-xs text-blue-400 border border-blue-400/30 px-3 py-1 rounded-full">
                    Google Gemini AI
                  </span>
                )}
              </div>
              
              <div className="space-y-4">
                <div className="flex items-baseline gap-4">
                  <span className={`text-3xl font-bold ${getRiskColor(result.risk_level)}`}>
                    {result.risk_level.toUpperCase()}
                  </span>
                  <span className="text-white/40 text-sm">
                    {Math.round(result.confidence * 100)}% confidence
                  </span>
                </div>

                <div className="border-t border-white/10 pt-4">
                  <p className="text-white/60 text-sm leading-relaxed">
                    {result.recommendation}
                  </p>
                </div>

                {result.threats.length > 0 && (
                  <div className="border-t border-white/10 pt-4">
                    <div className="text-white/40 text-xs mb-2">Threats Detected:</div>
                    <div className="flex flex-wrap gap-2">
                      {result.threats.map((threat, idx) => (
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

            {/* AI Analysis */}
            {result.analysis.ai_reasoning && (
              <div className="border border-white/10 rounded p-8">
                <h3 className="text-base font-light text-white/70 mb-6 tracking-wide">
                  Detailed AI Analysis
                </h3>
                <p className="text-white/60 text-sm leading-relaxed whitespace-pre-wrap">
                  {result.analysis.ai_reasoning}
                </p>
              </div>
            )}

            {/* Scraped Content */}
            {result.scraped_content && (
              <div className="border border-white/10 rounded p-8">
                <h3 className="text-base font-light text-white/70 mb-6 tracking-wide">
                  Scraped Content
                </h3>
                <div className="space-y-3">
                  <div>
                    <div className="text-white/40 text-xs mb-1">Title:</div>
                    <div className="text-white/80 text-sm">{result.scraped_content.title}</div>
                  </div>
                  <div>
                    <div className="text-white/40 text-xs mb-1">Content Preview:</div>
                    <div className="text-white/60 text-sm leading-relaxed">
                      {result.scraped_content.text}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Technical Details */}
            <div className="border border-white/10 rounded p-8">
              <h3 className="text-base font-light text-white/70 mb-6 tracking-wide">
                Technical Details
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-white/40 text-xs mb-1">Input Type</div>
                  <div className="text-white/80">{result.input_type.toUpperCase()}</div>
                </div>
                {result.analysis.scam_keywords_found !== undefined && (
                  <div>
                    <div className="text-white/40 text-xs mb-1">Scam Keywords</div>
                    <div className="text-white/80">{result.analysis.scam_keywords_found}</div>
                  </div>
                )}
                {result.analysis.phishing_patterns_found !== undefined && (
                  <div>
                    <div className="text-white/40 text-xs mb-1">Phishing Patterns</div>
                    <div className="text-white/80">{result.analysis.phishing_patterns_found}</div>
                  </div>
                )}
                {result.analysis.text_length !== undefined && (
                  <div>
                    <div className="text-white/40 text-xs mb-1">Content Length</div>
                    <div className="text-white/80">{result.analysis.text_length} chars</div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </ModuleLayout>
  )
}



