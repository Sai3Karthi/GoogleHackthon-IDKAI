"use client"

import { useState, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { ModuleLayout } from "./module-layout"
import { LiquidButton } from "../ui/liquid-glass-button"
import { saveModule1Data, getModule1Data, setCurrentModule, setSessionId } from "@/lib/session-manager"

interface AnalysisResult {
  session_id: string
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
    visual_elements?: string[]
    extracted_text?: string
  }
  recommendation: string
  scraped_content?: {
    title: string
    text: string
  } | null
  ai_powered: boolean
  image_info?: {
    format: string
    size_kb: number
    dimensions: [number, number]
    source: string
  }
  skip_to_final?: boolean
  skip_reason?: string
}

export function Module1() {
  const router = useRouter()
  const [input, setInput] = useState("")
  const [analysisMode, setAnalysisMode] = useState<"text" | "image">("text")
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState("")
  const [contextText, setContextText] = useState("")
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [redirectCountdown, setRedirectCountdown] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const redirectTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Restore state from session on mount
  useEffect(() => {
    const sessionData = getModule1Data()
    if (sessionData) {
      console.log('[Module1] Restoring from session:', sessionData)
      setInput(sessionData.input || "")
      setAnalysisMode(sessionData.analysisMode || "text")
      setResult(sessionData.result)
    }
    setCurrentModule(1)

    return () => {
      if (redirectTimerRef.current) {
        clearInterval(redirectTimerRef.current)
      }
    }
  }, [])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 4 * 1024 * 1024) {
      setError("Image too large. Maximum size is 4MB for deployment compatibility.")
      return
    }

    const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"]
    if (!validTypes.includes(file.type)) {
      setError("Invalid image format. Supported: JPEG, PNG, WEBP, GIF")
      return
    }

    setImageFile(file)
    setError(null)

    const reader = new FileReader()
    reader.onloadend = () => {
      setImagePreview(reader.result as string)
    }
    reader.readAsDataURL(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith("image/")) {
      const fakeEvent = { target: { files: [file] } } as any
      handleFileSelect(fakeEvent)
    }
  }

  const startRedirectCountdown = (path: string, queryParams?: string) => {
    setRedirectCountdown(10)
    
    redirectTimerRef.current = setInterval(() => {
      setRedirectCountdown((prev) => {
        if (prev === null || prev <= 1) {
          if (redirectTimerRef.current) {
            clearInterval(redirectTimerRef.current)
          }
          const url = queryParams ? `${path}?${queryParams}` : path
          console.log('[Module1] Redirecting to:', url)
          router.push(url)
          return null
        }
        return prev - 1
      })
    }, 1000)
  }

  const cancelRedirect = () => {
    if (redirectTimerRef.current) {
      clearInterval(redirectTimerRef.current)
      redirectTimerRef.current = null
    }
    setRedirectCountdown(null)
    console.log('[Module1] Auto-redirect cancelled')
  }

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
      if (data.session_id) {
        setSessionId(data.session_id)
      }
      setResult(data)
      
      // Save to session
      saveModule1Data({
        input: input.trim(),
        analysisMode,
        result: data
      })
      
      if (data.skip_to_final) {
        startRedirectCountdown('/modules/5', `source=module1&skip_reason=${encodeURIComponent(data.skip_reason || '')}`)
      } else {
        // Start countdown to Module 2 (10 seconds)
        startRedirectCountdown('/modules/2')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed")
    } finally {
      setLoading(false)
    }
  }

  const analyzeImage = async () => {
    if (!imageFile && !imageUrl.trim()) {
      setError("Please upload an image or provide an image URL")
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      let requestBody: any

      if (imageUrl.trim()) {
        requestBody = {
          image: imageUrl.trim(),
          image_type: "url",
          context_text: contextText.trim() || undefined,
        }
      } else if (imageFile) {
        const reader = new FileReader()
        const base64 = await new Promise<string>((resolve, reject) => {
          reader.onloadend = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsDataURL(imageFile)
        })

        requestBody = {
          image: base64,
          image_type: "base64",
          context_text: contextText.trim() || undefined,
        }
      }

      const response = await fetch("/module1/api/analyze-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: response.statusText }))
        throw new Error(errorData.detail || `Analysis failed: ${response.statusText}`)
      }

      const data: AnalysisResult = await response.json()
      if (data.session_id) {
        setSessionId(data.session_id)
      }
      setResult(data)
      
      // Save to session
      saveModule1Data({
        input: imageUrl.trim() || imageFile?.name || "image",
        analysisMode: "image",
        result: data
      })
      
      if (data.skip_to_final) {
        startRedirectCountdown('/modules/5', `source=module1&skip_reason=${encodeURIComponent(data.skip_reason || '')}`)
      } else {
        startRedirectCountdown('/modules/2')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Image analysis failed")
    } finally {
      setLoading(false)
    }
  }

  const clearAll = () => {
    setInput("")
    setImageFile(null)
    setImagePreview(null)
    setImageUrl("")
    setContextText("")
    setResult(null)
    setError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const clearInputOnly = () => {
    // Clear input fields but keep the result visible
    setInput("")
    setImageFile(null)
    setImagePreview(null)
    setImageUrl("")
    setContextText("")
    setError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const startNewSession = async () => {
    if (confirm('Start a new session? This will clear all current analysis data.')) {
      console.log('[Module1] Starting new session - clearing all data')
      
      const { clearAllData } = require('@/lib/session-manager')
      await clearAllData()
      
      clearAll()
      
      if (redirectTimerRef.current) {
        clearInterval(redirectTimerRef.current)
        redirectTimerRef.current = null
      }
      setRedirectCountdown(null)
      setAnalysisMode("text")
      
      console.log('[Module1] New session started')
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
        {/* Mode Selector & New Session */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex gap-4">
            <button
              onClick={() => { setAnalysisMode("text"); clearInputOnly(); }}
              className={`px-6 py-2 text-sm transition-all ${
                analysisMode === "text"
                  ? "text-white border-b-2 border-white"
                  : "text-white/40 hover:text-white/70"
              }`}
            >
              Text/URL Analysis
            </button>
            <button
              onClick={() => { setAnalysisMode("image"); clearInputOnly(); }}
              className={`px-6 py-2 text-sm transition-all ${
                analysisMode === "image"
                  ? "text-white border-b-2 border-white"
                  : "text-white/40 hover:text-white/70"
              }`}
            >
              Image Analysis
            </button>
          </div>
          <button
            onClick={startNewSession}
            className="px-4 py-2 border border-yellow-500/30 rounded text-sm text-yellow-400 hover:bg-yellow-500/10 transition-all"
          >
             New Session
          </button>
        </div>

        {analysisMode === "text" && (
          <div className="border border-white/10 rounded p-8">
            <h2 className="text-base font-light text-white/70 mb-6 tracking-wide">Analyze Text or URL</h2>
            
            <div className="border border-blue-500/30 bg-blue-500/5 rounded-lg p-4 mb-6">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <div className="text-sm text-blue-300 leading-relaxed">
                  <strong>Processing Time Notice:</strong> Daily news and simple content analyze quickly. Complex or critical information may take longer to process through all modules, especially Module 4 enrichment which searches the web for verification.
                </div>
              </div>
            </div>
            
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
                    onClick={clearAll}
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
        )}

        {analysisMode === "image" && (
          <div className="border border-white/10 rounded p-8">
            <h2 className="text-base font-light text-white/70 mb-6 tracking-wide">Analyze Image for Scams</h2>
            
            <div className="border border-blue-500/30 bg-blue-500/5 rounded-lg p-4 mb-6">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <div className="text-sm text-blue-300 leading-relaxed">
                  <strong>Processing Time Notice:</strong> Daily news and simple content analyze quickly. Complex or critical information may take longer to process through all modules, especially Module 4 enrichment which searches the web for verification.
                </div>
              </div>
            </div>
            
            <div className="space-y-6">
              <div className="space-y-4">
                <div className="text-white/40 text-xs mb-2">Upload Image or Provide URL:</div>
                
                {/* File Upload Area */}
                <div
                  onDrop={handleDrop}
                  onDragOver={(e) => e.preventDefault()}
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-white/10 rounded p-8 text-center cursor-pointer hover:border-white/30 transition-all bg-black/20"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={handleFileSelect}
                    className="hidden"
                    disabled={loading}
                  />
                  
                  {imagePreview ? (
                    <div className="space-y-4">
                      <img
                        src={imagePreview}
                        alt="Preview"
                        className="max-h-64 mx-auto rounded border border-white/10"
                      />
                      <p className="text-white/60 text-sm">
                        {imageFile?.name} ({(imageFile?.size! / 1024).toFixed(0)} KB)
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="text-white/60 text-sm">Drop image here or click to upload</div>
                      <div className="text-white/40 text-xs">Max 4MB - JPEG, PNG, WEBP, GIF</div>
                    </div>
                  )}
                </div>

                {/* OR Divider */}
                <div className="flex items-center gap-4">
                  <div className="flex-1 border-t border-white/10" />
                  <span className="text-white/40 text-xs">OR</span>
                  <div className="flex-1 border-t border-white/10" />
                </div>

                {/* Image URL Input */}
                <input
                  type="url"
                  value={imageUrl}
                  onChange={(e) => { setImageUrl(e.target.value); setImageFile(null); setImagePreview(null); }}
                  placeholder="Paste image URL here..."
                  className="w-full bg-black/30 text-white/90 rounded border border-white/10 p-4 focus:border-white/30 focus:outline-none text-sm"
                  disabled={loading}
                />
              </div>

              {/* Context Text (Optional) */}
              <div className="space-y-2">
                <div className="text-white/40 text-xs">Additional Context (Optional):</div>
                <textarea
                  value={contextText}
                  onChange={(e) => setContextText(e.target.value)}
                  placeholder="Add context about the image (e.g., 'Received this WhatsApp message...')"
                  className="w-full h-20 bg-black/30 text-white/90 rounded border border-white/10 p-4 focus:border-white/30 focus:outline-none resize-none text-sm"
                  disabled={loading}
                />
              </div>

              {/* Action Buttons */}
              <div className="flex gap-4">
                <LiquidButton
                  onClick={analyzeImage}
                  disabled={loading || (!imageFile && !imageUrl.trim())}
                  className="flex-1"
                >
                  {loading ? "Analyzing Image with AI..." : "Analyze Image"}
                </LiquidButton>
                
                {(result || error || imageFile || imageUrl) && (
                  <button
                    onClick={clearAll}
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
        )}

        {/* Results */}
        {result && (
          <>
            {/* Auto-Redirect Notification */}
            {redirectCountdown !== null && (
              <div className={`border rounded p-6 animate-fadeIn ${
                result.skip_to_final 
                  ? 'border-yellow-500/30 bg-yellow-500/5' 
                  : 'border-blue-500/30 bg-blue-500/5'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-full border-2 flex items-center justify-center ${
                      result.skip_to_final 
                        ? 'border-yellow-500/50' 
                        : 'border-blue-500/50'
                    }`}>
                      <span className={`text-xl font-light ${
                        result.skip_to_final 
                          ? 'text-yellow-400' 
                          : 'text-blue-400'
                      }`}>{redirectCountdown}</span>
                    </div>
                    <div>
                      <p className="text-white/90 text-sm font-medium mb-1">
                        {result.skip_to_final 
                          ? 'Skipping to Module 5: Final Analysis' 
                          : 'Redirecting to Module 2: Classification'}
                      </p>
                      <p className="text-white/50 text-xs">
                        {result.skip_to_final 
                          ? result.skip_reason 
                          : 'Your content will be classified and scored for significance'}
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

            {/* Image Analysis Details */}
            {result.input_type === "image" && (
              <>
                {result.analysis.visual_elements && result.analysis.visual_elements.length > 0 && (
                  <div className="border border-white/10 rounded p-8">
                    <h3 className="text-base font-light text-white/70 mb-6 tracking-wide">
                      Visual Elements Detected
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {result.analysis.visual_elements.map((element, idx) => (
                        <span
                          key={idx}
                          className="text-xs px-3 py-1 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full"
                        >
                          {element}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {result.analysis.extracted_text && (
                  <div className="border border-white/10 rounded p-8">
                    <h3 className="text-base font-light text-white/70 mb-6 tracking-wide">
                      Text Extracted from Image (OCR)
                    </h3>
                    <p className="text-white/60 text-sm leading-relaxed whitespace-pre-wrap font-mono">
                      {result.analysis.extracted_text}
                    </p>
                  </div>
                )}

                {result.image_info && (
                  <div className="border border-white/10 rounded p-8">
                    <h3 className="text-base font-light text-white/70 mb-6 tracking-wide">
                      Image Information
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <div className="text-white/40 text-xs mb-1">Format</div>
                        <div className="text-white/80">{result.image_info.format}</div>
                      </div>
                      <div>
                        <div className="text-white/40 text-xs mb-1">Size</div>
                        <div className="text-white/80">{result.image_info.size_kb} KB</div>
                      </div>
                      <div>
                        <div className="text-white/40 text-xs mb-1">Dimensions</div>
                        <div className="text-white/80">
                          {result.image_info.dimensions[0]} × {result.image_info.dimensions[1]}
                        </div>
                      </div>
                      <div>
                        <div className="text-white/40 text-xs mb-1">Source</div>
                        <div className="text-white/80">{result.image_info.source.toUpperCase()}</div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

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



