"use client"

import { useEffect, useState, useRef } from "react"
import { ModuleLayout } from "./module-layout"
import { LiquidButton } from "../ui/liquid-glass-button"
import {
  saveModule4Data,
  clearModule4Data,
  clearFinalAnalysisData,
  setCurrentModule
} from "@/lib/session-manager"

interface DebateMessage {
  agent: string
  message?: string
  argument?: string
  round?: number
}

interface DebateResult {
  status: string
  message: string
  trust_score?: number
  judgment?: string
  debate_file?: string
  debate_transcript?: DebateMessage[]
  topic?: string
  final_verdict?: {
    trust_score?: number
    reasoning?: string
    message?: string
    recommendation?: string
  }
}

interface EnrichmentResult {
  status: string
  message: string
  enriched_files?: {
    leftist?: string
    rightist?: string
    common?: string
  }
  total_links_found?: number
  total_relevant_links?: number
  summary?: {
    [filename: string]: {
      total_items: number
      items_with_links: number
    }
  }
}

interface Module4Cache {
  debateResult: DebateResult
  enrichmentResult?: EnrichmentResult
  timestamp: number
  inputHash: string
}

const CACHE_KEY = 'module4_debate_cache'
const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export function Module4Client() {
  const [loading, setLoading] = useState(false)
  const [debateResult, setDebateResult] = useState<DebateResult | null>(null)
  const [enrichmentResult, setEnrichmentResult] = useState<EnrichmentResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [backendStatus, setBackendStatus] = useState<string>("checking")
  const [processingStep, setProcessingStep] = useState<string>("")
  const [debugLogs, setDebugLogs] = useState<string[]>([])
  const [showDebugTerminal, setShowDebugTerminal] = useState<boolean>(false)
  const [liveDebateMessages, setLiveDebateMessages] = useState<DebateMessage[]>([])
  const debugTerminalRef = useRef<HTMLDivElement>(null)
  const debateViewRef = useRef<HTMLDivElement>(null)

  const addDebugLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString()
    setDebugLogs(prev => [...prev, `[${timestamp}] ${message}`])
  }

  const loadFromCache = () => {
    try {
      const cached = localStorage.getItem(CACHE_KEY)
      if (cached) {
        const cacheData: Module4Cache = JSON.parse(cached)
        const age = Date.now() - cacheData.timestamp
        
        if (age < CACHE_EXPIRY_MS) {
          console.log('[Module4] Loaded from cache:', cacheData.debateResult)
          setDebateResult(cacheData.debateResult)
          if (cacheData.enrichmentResult) {
            setEnrichmentResult(cacheData.enrichmentResult)
          }
          saveModule4Data({
            debateResult: cacheData.debateResult,
            enrichmentResult: cacheData.enrichmentResult ?? null
          })
        } else {
          console.log('[Module4] Cache expired')
          localStorage.removeItem(CACHE_KEY)
        }
      }
    } catch (error) {
      console.error('[Module4] Error loading cache:', error)
    }
  }

  const saveToCache = (result: DebateResult, enrichment?: EnrichmentResult) => {
    try {
      const cacheData: Module4Cache = {
        debateResult: result,
        enrichmentResult: enrichment || undefined,
        timestamp: Date.now(),
        inputHash: Date.now().toString()
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData))
      console.log('[Module4] Saved to cache')
    } catch (error) {
      console.error('[Module4] Error saving cache:', error)
    }
  }

  const checkBackendHealth = async () => {
    try {
      console.log('[Module4] Checking backend health at /module4/api/health')
      const response = await fetch("/module4/api/health", {
        cache: 'no-store'
      })
      console.log('[Module4] Health check response:', response.status, response.statusText)
      
      if (response.ok) {
        const data = await response.json()
        console.log('[Module4] Backend health data:', data)
        setBackendStatus("ready")
        console.log('[Module4] Backend health check passed')
      } else {
        const errorText = await response.text()
        console.error('[Module4] Backend health check failed:', response.status, errorText)
        setBackendStatus("unavailable")
        setError(`Backend not available: ${response.status} ${response.statusText}`)
      }
    } catch (err) {
      console.error('[Module4] Backend health check error:', err)
      setBackendStatus("unavailable")
      setError(`Failed to connect to backend: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ONLY run on mount, client-side only
  useEffect(() => {
    setCurrentModule(4)
    
    // Add styles
    const style = document.createElement('style')
    style.textContent = `
      .custom-scrollbar::-webkit-scrollbar { width: 0px; background: transparent; }
      .custom-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
      @keyframes fade-in-up {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .animate-fade-in-up { animation: fade-in-up 0.6s ease-out; }
    `
    document.head.appendChild(style)
    
    // Initialize
    checkBackendHealth()
    loadFromCache()
    
    return () => {
      if (document.head.contains(style)) {
        document.head.removeChild(style)
      }
    }
  }, [])

  const startDebateProcess = async () => {
    setLoading(true)
    setError(null)
    setDebateResult(null)
    setEnrichmentResult(null)
    setProcessingStep("")
    setDebugLogs([])
    setLiveDebateMessages([])
    setShowDebugTerminal(true)
    let latestEnrichment: EnrichmentResult | null = null
    
    try {
      console.log('[Module4] Starting complete debate process...')
      addDebugLog('[INFO] Starting complete debate process')
      
      // Check if files already exist first
      const statusResponse = await fetch('/module4/api/status', { cache: 'no-store' })
      const statusData = await statusResponse.json()
      const hasBaseFiles = statusData.perspective_files?.leftist && 
                           statusData.perspective_files?.rightist && 
                           statusData.perspective_files?.common
      const hasEnrichedFiles = statusData.enriched_files_exist === true
      
      // Step 1: Fetch perspectives from Module 3 (if base files don't exist)
      if (!hasBaseFiles) {
        setProcessingStep("Step 1/3: Fetching perspectives from Module 3...")
        console.log('[Module4] Step 1/3: Requesting Module 3 to send perspective data to Module 4...')
        addDebugLog('[STEP 1/3] Fetching perspectives from Module 3...')
        
        const sendDataResponse = await fetch('/module3/api/send_to_module4', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store'
        })
        
        if (!sendDataResponse.ok) {
          const errorText = await sendDataResponse.text()
          console.error('[Module4] Module 3 failed to send data:', sendDataResponse.status, errorText)
          throw new Error(`Module 3 failed to send data to Module 4: ${sendDataResponse.status}. Make sure Module 3 has completed processing.`)
        }
        
        const sendDataResult = await sendDataResponse.json()
        console.log('[Module4] Module 3 sent data to Module 4:', sendDataResult)
        
        // Module 3 wraps the response in module4_response
        const counts = sendDataResult.module4_response?.counts || sendDataResult.counts || {}
        const total = counts.total || 0
        const leftist = counts.leftist || 0
        const rightist = counts.rightist || 0
        const common = counts.common || 0
        
        addDebugLog(`[SUCCESS] Received ${total} perspectives from Module 3`)
        addDebugLog(`[DATA] Leftist: ${leftist}`)
        addDebugLog(`[DATA] Rightist: ${rightist}`)
        addDebugLog(`[DATA] Common: ${common}`)
      } else {
        addDebugLog('[SKIP] Step 1/3: Perspective files already exist in Module 4')
        addDebugLog('[INFO] Using existing data instead of fetching from Module 3')
      }
      
      // Step 2: Enrich perspectives (if enriched files don't exist)
      if (hasEnrichedFiles) {
        addDebugLog('[SKIP] Step 2/3: Enriched files already exist, skipping enrichment')
        addDebugLog('[INFO] Using existing enriched data for debate')
      } else {
        setProcessingStep("Step 2/3: Enriching with web evidence (Google Search + AI verification)... This may take up to 15 minutes.")
        console.log('[Module4] Step 2/3: Enriching perspectives with web evidence...')
        addDebugLog('[STEP 2/3] Starting web enrichment process...')
        addDebugLog('[INFO] This may take up to 15 minutes')
        addDebugLog('[CONFIG] Region: India (Asia) | Method: Selenium + AI verification')
        
        // Start enrichment in background (fire and forget)
        let enrichmentStarted = false
        try {
          const enrichUrl = "/module4/api/enrich-perspectives"
          addDebugLog('[INFO] Starting enrichment (this will run in background)...')
          
          // Start enrichment without waiting for response
          fetch(enrichUrl, {
            method: "POST",
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-store'
          }).catch(err => {
            console.error('[Module4] Enrichment start error:', err)
            addDebugLog(`[ERROR] Failed to start enrichment: ${err.message}`)
          })
          
          enrichmentStarted = true
          addDebugLog('[INFO] Enrichment started in background')
          
          // Poll for completion (check every 10 seconds for up to 20 minutes)
          const maxWaitTime = 20 * 60 * 1000 // 20 minutes
          const pollInterval = 10000 // 10 seconds
          const startTime = Date.now()
          
          let enrichmentComplete = false
          let pollCount = 0
          
          while (!enrichmentComplete && (Date.now() - startTime) < maxWaitTime) {
            pollCount++
            await new Promise(resolve => setTimeout(resolve, pollInterval))
            
            try {
              // Check if enriched files exist
              const statusResponse = await fetch('/module4/api/status', { cache: 'no-store' })
              const statusData = await statusResponse.json()
              
              // Check for relevant_*.json files
              const hasEnrichedFiles = statusData.enriched_files_exist === true
              
              if (hasEnrichedFiles) {
                enrichmentComplete = true
                addDebugLog('[SUCCESS] Enrichment completed!')
                
                // Try to get enrichment results
                try {
                  const enrichResultResponse = await fetch('/module4/api/enrichment-result', { cache: 'no-store' })
                  if (enrichResultResponse.ok) {
                    const enrichData = await enrichResultResponse.json()
                    latestEnrichment = enrichData
                    setEnrichmentResult(enrichData)
                    const totalLinks = enrichData.total_relevant_links || enrichData.total_links_found || 0
                    addDebugLog(`[SUCCESS] Found ${totalLinks} verified web sources`)
                    if (enrichData.summary) {
                      for (const [filename, data] of Object.entries(enrichData.summary)) {
                        addDebugLog(`[DATA] ${filename}: ${(data as any).items_with_links}/${(data as any).total_items} enriched`)
                      }
                    }
                    setProcessingStep(`Step 2/3: Enrichment complete! Found ${totalLinks} verified web sources.`)
                  }
                } catch (err) {
                  console.error('[Module4] Failed to fetch enrichment results:', err)
                }
                
                break
              } else {
                const elapsed = Math.floor((Date.now() - startTime) / 1000)
                addDebugLog(`[INFO] Enrichment in progress... (${elapsed}s elapsed, poll ${pollCount})`)
                setProcessingStep(`Step 2/3: Enriching... (${elapsed}s elapsed, this may take up to 15 minutes)`)
              }
            } catch (err) {
              console.error('[Module4] Status check error:', err)
            }
          }
          
          if (!enrichmentComplete) {
            addDebugLog('[WARNING] Enrichment timeout, proceeding with base perspectives')
            setProcessingStep("Step 2/3: Web enrichment taking too long, using base perspectives...")
          }
          
          await new Promise(resolve => setTimeout(resolve, 1500))
          
        } catch (err) {
          console.error('[Module4] Enrichment error:', err)
          addDebugLog('[WARNING] Enrichment failed, proceeding with base perspectives')
          setProcessingStep("Step 2/3: Web enrichment skipped, using base perspectives...")
          await new Promise(resolve => setTimeout(resolve, 1500))
        }
      }
      
      setProcessingStep("Step 3/3: Running AI agent debate (Leftist vs Rightist vs Judge)... This may take several minutes.")
      console.log('[Module4] Step 3/3: Starting debate...')
      addDebugLog('[STEP 3/3] Starting AI agent debate...')
      addDebugLog('[INFO] Running multi-round debate with Leftist, Rightist, and Judge agents')
      
      // Try multiple times with direct orchestrator URL as fallback
      let debateResponse: Response | null = null
      let lastError: Error | null = null
      
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          addDebugLog(`[ATTEMPT ${attempt}/3] Calling debate endpoint...`)
          
          // First 2 attempts: use Next.js rewrite
          // Last attempt: bypass Next.js and go direct to orchestrator
          const url = attempt < 3 
            ? "/module4/api/debate"
            : "http://localhost:8000/module4/api/debate"
          
          console.log(`[Module4] Attempt ${attempt}: Calling ${url}`)
          
          debateResponse = await fetch(`${url}?use_enriched=true`, {
            method: "POST",
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-store'
          })
          
          console.log(`[Module4] Attempt ${attempt} response:`, debateResponse.status)
          
          if (debateResponse.ok) {
            addDebugLog(`[SUCCESS] Debate endpoint responded successfully`)
            break
          } else {
            const errorText = await debateResponse.text()
            console.error(`[Module4] Attempt ${attempt} failed:`, debateResponse.status, errorText)
            lastError = new Error(`${debateResponse.status}: ${errorText}`)
            addDebugLog(`[WARN] Attempt ${attempt} failed: ${debateResponse.status}`)
            
            if (attempt < 3) {
              addDebugLog(`[INFO] Retrying in 2 seconds...`)
              await new Promise(resolve => setTimeout(resolve, 2000))
            }
          }
        } catch (err) {
          console.error(`[Module4] Attempt ${attempt} error:`, err)
          lastError = err instanceof Error ? err : new Error(String(err))
          addDebugLog(`[ERROR] Attempt ${attempt}: ${lastError.message}`)
          
          if (attempt < 3) {
            addDebugLog(`[INFO] Retrying in 2 seconds...`)
            await new Promise(resolve => setTimeout(resolve, 2000))
          }
        }
      }
      
      if (!debateResponse || !debateResponse.ok) {
        const errorMsg = lastError?.message || 'Failed to start debate after 3 attempts'
        console.error('[Module4] All debate attempts failed:', errorMsg)
        throw new Error(errorMsg)
      }
      
      const data = await debateResponse.json()
      console.log('[Module4] Debate result:', data)
      
      // Simulate live debate by showing messages one by one
      const transcript = data.debate_transcript || []
      addDebugLog(`[INFO] Playing back ${transcript.length} debate rounds...`)
      
      for (let i = 0; i < transcript.length; i++) {
        setLiveDebateMessages(transcript.slice(0, i + 1))
        addDebugLog(`[DEBATE] Round ${i + 1} of ${transcript.length}`)
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
      
      addDebugLog(`[SUCCESS] Debate completed! ${transcript.length} rounds of debate`)
      addDebugLog(`[RESULT] Final trust score: ${data.trust_score || 'N/A'}`)
      addDebugLog('[INFO] Saving results and cache...')
      
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      setDebateResult(data)
      saveToCache(data, latestEnrichment || undefined)
      saveModule4Data({
        debateResult: data,
        enrichmentResult: latestEnrichment
      })
      setProcessingStep("")
      addDebugLog('[COMPLETE] All steps completed successfully!')
    } catch (err) {
      console.error('[Module4] Debate error:', err)
      addDebugLog(`[ERROR] ${err instanceof Error ? err.message : 'Unknown error'}`)
      setError(err instanceof Error ? err.message : "Failed to connect to Module 4 backend")
      setProcessingStep("")
    } finally {
      setLoading(false)
    }
  }

  const clearDebate = () => {
    setDebateResult(null)
    setEnrichmentResult(null)
    setError(null)
    localStorage.removeItem(CACHE_KEY)
    clearModule4Data()
    clearFinalAnalysisData()
    console.log('[Module4] Cleared debate and enrichment results and cache')
  }

  const getAgentDisplay = (agent: string) => {
    if (!agent) return { name: 'System', class: 'system' }
    const lowerAgent = agent.toLowerCase()
    if (lowerAgent.includes('leftist') || lowerAgent.includes('left')) {
      return { name: 'Leftist Agent', class: 'leftist' }
    } else if (lowerAgent.includes('rightist') || lowerAgent.includes('right')) {
      return { name: 'Rightist Agent', class: 'rightist' }
    } else if (lowerAgent.includes('judge') || lowerAgent.includes('moderator')) {
      return { name: 'Judge AI', class: 'judge' }
    } else {
      return { name: 'System', class: 'system' }
    }
  }

  return (
    <ModuleLayout
      moduleNumber={4}
      title="Agent Debate & Analysis"
      description="3-step process: fetch perspectives, enrich with web evidence, AI debate analysis"
      status={backendStatus === "ready" ? "ready" : "progress"}
    >
      <div className="space-y-12">
        {/* Core Principle */}
        <div className="border border-white/10 rounded p-8">
          <h3 className="text-base font-light text-white/70 mb-6 tracking-wide">Core Principle</h3>
          <div className="text-white/60 text-sm leading-relaxed">
            <p className="mb-4">
              <span className="text-white">"AI can never be sure if information is true, only humans can."</span>
            </p>
            <p>
              Therefore, we make the AI as sophisticated as possible to provide comprehensive analysis 
              that empowers human decision-making.
            </p>
          </div>
        </div>

        {/* Live Debate Analysis */}
        <div className="border border-white/10 rounded p-8">
          <h3 className="text-base font-light text-white/70 mb-6 tracking-wide">Live Debate Analysis</h3>
          
          <div className="mb-8">
            <h4 className="text-sm font-medium text-white/80 mb-4">3-Step Comprehensive Analysis</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="border border-white/10 rounded-lg p-4 text-center hover:border-cyan-500/30 transition-colors">
                <div className="w-10 h-10 rounded-full bg-cyan-500/20 border border-cyan-500/50 flex items-center justify-center mx-auto mb-3">
                  <span className="text-cyan-400 font-bold">1</span>
                </div>
                <div className="text-sm text-white/70 font-medium mb-2">Fetch Perspectives</div>
                <div className="text-xs text-white/40 leading-relaxed">Retrieves bias-analyzed perspectives from Module 3</div>
              </div>
              <div className="border border-white/10 rounded-lg p-4 text-center hover:border-purple-500/30 transition-colors">
                <div className="w-10 h-10 rounded-full bg-purple-500/20 border border-purple-500/50 flex items-center justify-center mx-auto mb-3">
                  <span className="text-purple-400 font-bold">2</span>
                </div>
                <div className="text-sm text-white/70 font-medium mb-2">Web Enrichment</div>
                <div className="text-xs text-white/40 leading-relaxed">Selenium Google search + Gemini AI verification for sources</div>
              </div>
              <div className="border border-white/10 rounded-lg p-4 text-center hover:border-green-500/30 transition-colors">
                <div className="w-10 h-10 rounded-full bg-green-500/20 border border-green-500/50 flex items-center justify-center mx-auto mb-3">
                  <span className="text-green-400 font-bold">3</span>
                </div>
                <div className="text-sm text-white/70 font-medium mb-2">AI Debate</div>
                <div className="text-xs text-white/40 leading-relaxed">Multi-round debate with judge AI for final verdict</div>
              </div>
            </div>
          </div>
          
          {/* Controls */}
          <div className="flex gap-3 mb-6">
            <LiquidButton 
              onClick={startDebateProcess} 
              disabled={loading || backendStatus !== "ready"}
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Processing...
                </>
              ) : "Start Complete Analysis"}
            </LiquidButton>

            {debugLogs.length > 0 && (
              <button
                onClick={() => setShowDebugTerminal(!showDebugTerminal)}
                className="px-4 py-2 border border-white/30 rounded text-white/80 hover:text-white hover:border-white/50 transition-colors text-sm"
              >
                {showDebugTerminal ? 'Hide Terminal' : 'Show Terminal'}
              </button>
            )}
            
            {debateResult && (
              <button onClick={clearDebate} className="px-4 py-2 border border-white/20 rounded text-white/60 hover:text-white hover:border-white/40 transition-colors text-sm">
                Clear
              </button>
            )}
          </div>

          {/* Status */}
          <div className="mb-6 flex items-center gap-2 text-sm">
            <div className={`w-2 h-2 rounded-full ${
              backendStatus === "ready" ? "bg-green-400 animate-pulse" : 
              backendStatus === "checking" ? "bg-yellow-400 animate-pulse" : 
              "bg-red-400"
            }`}></div>
            <span className="text-white/60">
              Status: <span className={`font-medium ${
                backendStatus === "ready" ? "text-green-400" : 
                backendStatus === "checking" ? "text-yellow-400" : "text-red-400"
              }`}>
                {backendStatus === "ready" ? "Connected" : 
                 backendStatus === "checking" ? "Checking..." : "Unavailable"}
              </span>
            </span>
          </div>

          {/* Error */}
          {error && (
            <div className="border border-red-500/30 bg-red-500/5 rounded p-4 mb-6">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="border border-blue-500/30 bg-blue-500/5 rounded p-4 mb-6">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></div>
                <span className="text-blue-400 text-sm font-medium">Processing...</span>
              </div>
              {processingStep && (
                <div className="ml-4 text-white/60 text-xs mt-1">{processingStep}</div>
              )}
            </div>
          )}

          {/* Debug Terminal */}
          {showDebugTerminal && debugLogs.length > 0 && (
            <div className="border border-white/30 bg-black rounded-lg overflow-hidden mb-6">
              <div className="flex items-center justify-between bg-white/5 border-b border-white/30 px-4 py-2">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-white animate-pulse"></div>
                  <span className="text-white text-xs font-mono font-bold">DEBUG TERMINAL</span>
                </div>
                <button onClick={() => setShowDebugTerminal(false)} className="text-white/60 hover:text-white text-xs">X</button>
              </div>
              <div ref={debugTerminalRef} className="p-4 font-mono text-xs text-white/90 max-h-96 overflow-y-auto custom-scrollbar bg-black">
                {debugLogs.map((log, idx) => (
                  <div key={idx} className="mb-1 whitespace-pre-wrap leading-relaxed">{log}</div>
                ))}
                {loading && (
                  <div className="flex items-center gap-2 text-white/80 animate-pulse mt-2">
                    <span>&gt;</span>
                    <span>Processing...</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Results placeholder */}
          {!debateResult && !loading && !error && (
            <div className="border border-white/10 rounded p-12 text-center">
              <svg className="w-16 h-16 mx-auto mb-4 text-white/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a2 2 0 01-2-2v-6a2 2 0 012-2h8z"></path>
              </svg>
              <p className="text-white/40 text-sm mb-2">Ready for comprehensive analysis.</p>
              <p className="text-white/30 text-xs">Click "Start Complete Analysis" to fetch data, enrich with web evidence, and run AI debate.</p>
            </div>
          )}

          {/* Results */}
          {debateResult && (
            <div className="space-y-6">
              <div className="border border-green-500/30 bg-green-500/5 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                  </svg>
                  <span className="text-xs font-medium text-green-400 uppercase tracking-wider">Completed</span>
                </div>
                <p className="text-white/70 text-sm">{debateResult.message || 'Debate analysis completed successfully'}</p>
              </div>
              
              {debateResult.judgment && (
                <div className="border border-purple-500/30 bg-purple-500/5 rounded-lg p-5">
                  <h4 className="text-xs font-medium text-purple-400 mb-3 uppercase tracking-wider">Final Judgment</h4>
                  <p className="text-white/80 text-sm leading-relaxed whitespace-pre-wrap">{debateResult.judgment}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </ModuleLayout>
  )
}