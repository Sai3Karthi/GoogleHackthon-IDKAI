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
  agent_type?: string
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

interface EnrichmentItem {
  category: string
  perspective_text: string
  url: string
  title: string
  trust_score: number
  source_type: string
  extracted_text: string
}

export function Module4Client() {
  const [loading, setLoading] = useState(false)
  const [debateResult, setDebateResult] = useState<DebateResult | null>(null)
  const [enrichmentResult, setEnrichmentResult] = useState<EnrichmentResult | null>(null)
  const [enrichmentItems, setEnrichmentItems] = useState<EnrichmentItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [backendStatus, setBackendStatus] = useState<string>("checking")
  const [processingStep, setProcessingStep] = useState<string>("")
  const [debugLogs, setDebugLogs] = useState<string[]>([])
  const [showDebugTerminal, setShowDebugTerminal] = useState<boolean>(false)
  const [liveDebateMessages, setLiveDebateMessages] = useState<DebateMessage[]>([])
  const [showEnrichmentItems, setShowEnrichmentItems] = useState<boolean>(false)
  const [showDebateMessages, setShowDebateMessages] = useState<boolean>(false)
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
    setEnrichmentItems([])
    setLiveDebateMessages([])
    setShowEnrichmentItems(false)
    setShowDebateMessages(false)
    setProcessingStep("")
    setDebugLogs([])
    setShowDebugTerminal(true)
    let latestEnrichment: EnrichmentResult | null = null
    
    try {
      console.log('[Module4] Starting complete debate process...')
      addDebugLog('[INFO] Starting complete debate process')
      
      // Step 1: Fetch perspectives from Module 3
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
      
      // Step 2: Enrich perspectives with web evidence
      {
        setProcessingStep("Step 2/3: Enriching with web evidence (Google Search + AI verification)... This may take up to 15 minutes.")
        console.log('[Module4] Step 2/3: Enriching perspectives with web evidence...')
        addDebugLog('[STEP 2/3] Starting web enrichment process...')
        addDebugLog('[INFO] This may take up to 15 minutes')
        addDebugLog('[CONFIG] Region: India (Asia) | Method: Selenium + AI verification')
        
        try {
          const enrichUrl = "/module4/api/enrich-perspectives"
          addDebugLog('[INFO] Calling enrichment endpoint...')
          
          const controller = new AbortController()
          const enrichResponse = await fetch(enrichUrl, {
            method: "POST",
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-store',
            signal: controller.signal,
            keepalive: true
          })
          
          if (enrichResponse.ok) {
            const enrichData = await enrichResponse.json()
            
            if (enrichData.status === "completed") {
              latestEnrichment = enrichData
              setEnrichmentResult(enrichData)
              const totalLinks = enrichData.total_relevant_links || enrichData.total_links_found || 0
              addDebugLog(`[SUCCESS] Enrichment completed with ${totalLinks} verified web sources`)
              setProcessingStep(`Step 2/3: Enrichment complete! Found ${totalLinks} verified web sources.`)
              
              // Fetch enrichment items for display immediately
              addDebugLog('[INFO] Fetching enrichment items for display...')
              try {
                const itemsResponse = await fetch('/module4/api/enrichment-items', { cache: 'no-store' })
                if (itemsResponse.ok) {
                  const itemsData = await itemsResponse.json()
                  if (itemsData.status === "completed" && itemsData.items.length > 0) {
                    setEnrichmentItems(itemsData.items)
                    setShowEnrichmentItems(true)
                    addDebugLog(`[SUCCESS] Loaded ${itemsData.total_items} enrichment items for display`)
                    await new Promise(resolve => setTimeout(resolve, 2000))
                  }
                }
              } catch (err) {
                console.error('[Module4] Failed to fetch enrichment items:', err)
              }
            } else {
              addDebugLog('[WARNING] Enrichment did not complete, proceeding with base perspectives')
            }
          } else {
            addDebugLog('[WARNING] Enrichment endpoint failed, proceeding with base perspectives')
          }
          
          await new Promise(resolve => setTimeout(resolve, 1000))
          
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
      addDebugLog(`[SUCCESS] Debate completed!`)
      
      // Fetch debate messages for animated display
      addDebugLog('[INFO] Fetching debate messages for display...')
      try {
        const messagesResponse = await fetch('/module4/api/debate-messages', { cache: 'no-store' })
        if (messagesResponse.ok) {
          const messagesData = await messagesResponse.json()
          if (messagesData.status === "completed") {
            const allMessages = messagesData.messages
            addDebugLog(`[INFO] Playing back ${allMessages.length} debate messages...`)
            setShowDebateMessages(true)
            
            // Animate messages one by one
            for (let i = 0; i < allMessages.length; i++) {
              setLiveDebateMessages(allMessages.slice(0, i + 1))
              addDebugLog(`[DEBATE] Message ${i + 1} of ${allMessages.length} - ${allMessages[i].agent}`)
              await new Promise(resolve => setTimeout(resolve, 1500))
            }
          }
        }
      } catch (err) {
        console.error('[Module4] Failed to fetch debate messages:', err)
      }
      
      addDebugLog(`[RESULT] Final trust score: ${data.trust_score || 'N/A'}`)
      addDebugLog('[INFO] Saving results and cache...')
      
      await new Promise(resolve => setTimeout(resolve, 1500))
      
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
    setEnrichmentItems([])
    setLiveDebateMessages([])
    setShowEnrichmentItems(false)
    setShowDebateMessages(false)
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

          {/* Enrichment Items Display */}
          {showEnrichmentItems && enrichmentItems.length > 0 && (
            <div className="border border-cyan-500/30 bg-cyan-500/5 rounded-lg p-6 mb-6 animate-fade-in-up">
              <div className="flex items-center gap-2 mb-4">
                <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                </svg>
                <h4 className="text-sm font-medium text-cyan-400 uppercase tracking-wider">Web Evidence Found</h4>
                <span className="text-xs text-white/40 ml-auto">{enrichmentItems.length} sources</span>
              </div>
              <div className="space-y-3 max-h-96 overflow-y-auto custom-scrollbar">
                {enrichmentItems.map((item, idx) => (
                  <div key={idx} className="border border-white/10 bg-black/30 rounded p-4 hover:border-cyan-500/30 transition-all animate-fade-in-up" style={{ animationDelay: `${idx * 0.1}s` }}>
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs px-2 py-0.5 rounded ${
                            item.category === 'leftist' ? 'bg-blue-500/20 text-blue-400' :
                            item.category === 'rightist' ? 'bg-red-500/20 text-red-400' :
                            'bg-purple-500/20 text-purple-400'
                          }`}>
                            {item.category}
                          </span>
                          <span className="text-xs text-white/40">{item.source_type}</span>
                        </div>
                        <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-sm text-cyan-400 hover:text-cyan-300 hover:underline line-clamp-1">
                          {item.title}
                        </a>
                      </div>
                      <div className="flex items-center gap-1 px-2 py-1 rounded bg-white/5">
                        <svg className="w-3 h-3 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"></path>
                        </svg>
                        <span className="text-xs text-white/70 font-medium">{(item.trust_score * 100).toFixed(0)}%</span>
                      </div>
                    </div>
                    <p className="text-xs text-white/50 leading-relaxed mb-2">{item.perspective_text}</p>
                    {item.extracted_text && (
                      <p className="text-xs text-white/40 italic leading-relaxed">&quot;{item.extracted_text}&quot;</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Debate Messages Display (Animated Messenger Style) */}
          {showDebateMessages && liveDebateMessages.length > 0 && (
            <div className="border border-purple-500/30 bg-purple-500/5 rounded-lg p-6 mb-6 animate-fade-in-up">
              <div className="flex items-center gap-2 mb-4">
                <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path>
                </svg>
                <h4 className="text-sm font-medium text-purple-400 uppercase tracking-wider">AI Debate in Progress</h4>
                <span className="text-xs text-white/40 ml-auto">{liveDebateMessages.length} messages</span>
              </div>
              <div ref={debateViewRef} className="space-y-4 max-h-[500px] overflow-y-auto custom-scrollbar">
                {liveDebateMessages.map((msg, idx) => {
                  const isLeftist = msg.agent_type === 'leftist'
                  const isRightist = msg.agent_type === 'rightist'
                  const isJudge = msg.agent_type === 'judge'
                  
                  return (
                    <div key={idx} className={`flex ${isJudge ? 'justify-center' : isRightist ? 'justify-end' : 'justify-start'} animate-fade-in-up`} style={{ animationDelay: `${idx * 0.1}s` }}>
                      <div className={`max-w-[80%] rounded-lg p-4 ${
                        isLeftist ? 'bg-blue-500/20 border border-blue-500/30' :
                        isRightist ? 'bg-red-500/20 border border-red-500/30' :
                        isJudge ? 'bg-yellow-500/20 border border-yellow-500/30 text-center' :
                        'bg-white/10 border border-white/20'
                      }`}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`text-xs font-bold uppercase tracking-wider ${
                            isLeftist ? 'text-blue-400' :
                            isRightist ? 'text-red-400' :
                            isJudge ? 'text-yellow-400' :
                            'text-white/60'
                          }`}>
                            {msg.agent}
                          </span>
                          {msg.round && msg.round > 0 && (
                            <span className="text-xs text-white/40">Round {msg.round}</span>
                          )}
                        </div>
                        <p className="text-sm text-white/80 leading-relaxed whitespace-pre-wrap">{msg.message}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Results placeholder */}
          {!debateResult && !loading && !error && !showEnrichmentItems && !showDebateMessages && (
            <div className="border border-white/10 rounded p-12 text-center">
              <svg className="w-16 h-16 mx-auto mb-4 text-white/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a2 2 0 01-2-2v-6a2 2 0 012-2h8z"></path>
              </svg>
              <p className="text-white/40 text-sm mb-2">Ready for comprehensive analysis.</p>
              <p className="text-white/30 text-xs">Click "Start Complete Analysis" to fetch data, enrich with web evidence, and run AI debate.</p>
            </div>
          )}

          {/* Final Summary */}
          {debateResult && (
            <div className="space-y-6 animate-fade-in-up">
              <div className="border border-green-500/30 bg-green-500/5 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                  </svg>
                  <span className="text-xs font-medium text-green-400 uppercase tracking-wider">Analysis Completed</span>
                </div>
                <p className="text-white/70 text-sm">{debateResult.message || 'Debate analysis completed successfully'}</p>
              </div>
              
              {debateResult.trust_score !== undefined && (
                <div className="border border-blue-500/30 bg-blue-500/5 rounded-lg p-5">
                  <h4 className="text-xs font-medium text-blue-400 mb-3 uppercase tracking-wider">Trust Score</h4>
                  <div className="flex items-center gap-4">
                    <div className="text-4xl font-bold text-blue-400">{debateResult.trust_score}%</div>
                    <div className="flex-1">
                      <div className="w-full bg-white/10 rounded-full h-3">
                        <div className="bg-blue-500 h-3 rounded-full transition-all duration-1000" style={{ width: `${debateResult.trust_score}%` }}></div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
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