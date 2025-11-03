"use client"

import { useEffect, useState, useRef } from "react"
import { ModuleLayout } from "./module-layout"
import { LiquidButton } from "../ui/liquid-glass-button"

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

export function Module4() {
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
      const response = await fetch("/module4/api/health")
      if (response.ok) {
        setBackendStatus("ready")
        console.log('[Module4] Backend health check passed')
      } else {
        setBackendStatus("unavailable")
        console.error('[Module4] Backend health check failed:', response.status)
      }
    } catch (err) {
      setBackendStatus("unavailable")
      console.error('[Module4] Backend health check error:', err)
    }
  }

  useEffect(() => {
    checkBackendHealth()
    loadFromCache()
    
    // Add custom scrollbar styles
    const style = document.createElement('style')
    style.textContent = `
      .custom-scrollbar::-webkit-scrollbar {
        width: 0px;
        background: transparent;
      }
      .custom-scrollbar {
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
      @keyframes fade-in-up {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      .animate-fade-in-up {
        animation: fade-in-up 0.6s ease-out;
      }
    `
    document.head.appendChild(style)
    
    return () => {
      document.head.removeChild(style)
    }
  }, [])

  useEffect(() => {
    if (debugTerminalRef.current) {
      debugTerminalRef.current.scrollTop = debugTerminalRef.current.scrollHeight
    }
  }, [debugLogs])

  useEffect(() => {
    if (debateViewRef.current) {
      debateViewRef.current.scrollTop = debateViewRef.current.scrollHeight
    }
  }, [liveDebateMessages])

  const checkForExistingData = async () => {
    try {
      const response = await fetch('/module4/api/status')
      if (response.ok) {
        const status = await response.json()
        if (status.ready_for_debate && !debateResult && !loading) {
          console.log('[Module4] Found existing perspective data, auto-starting debate...')
          setTimeout(() => startDebateProcess(), 1000)
        }
      }
    } catch (err) {
      console.error('[Module4] Error checking for existing data:', err)
    }
  }

  useEffect(() => {
    if (backendStatus === "ready") {
      checkForExistingData()
    }
  }, [backendStatus])

  const startDebateProcess = async () => {
    setLoading(true)
    setError(null)
    setDebateResult(null)
    setEnrichmentResult(null)
    setProcessingStep("")
    setDebugLogs([])
    setLiveDebateMessages([])
    setShowDebugTerminal(true)
    
    try {
      console.log('[Module4] Starting complete debate process...')
      addDebugLog('[INFO] Starting complete debate process')
      
      // Check if relevant files already exist first
      const statusResponse = await fetch('/module4/api/status')
      const statusData = await statusResponse.json()
      const hasBaseFiles = statusData.perspective_files?.leftist && 
                           statusData.perspective_files?.rightist && 
                           statusData.perspective_files?.common
      
      if (!hasBaseFiles) {
        setProcessingStep("Step 1/3: Fetching perspectives from Module 3...")
        console.log('[Module4] Step 1/3: Requesting Module 3 to send perspective data to Module 4...')
        addDebugLog('[STEP 1/3] Fetching perspectives from Module 3...')
        
        const sendDataResponse = await fetch('/module3/api/send_to_module4', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        })
        
        if (!sendDataResponse.ok) {
          const errorText = await sendDataResponse.text()
          console.error('[Module4] Module 3 failed to send data:', sendDataResponse.status, errorText)
          throw new Error(`Module 3 failed to send data to Module 4: ${sendDataResponse.status}. Make sure Module 3 has completed processing.`)
        }
        
        const sendDataResult = await sendDataResponse.json()
        console.log('[Module4] Module 3 sent data to Module 4:', sendDataResult)
        addDebugLog(`[SUCCESS] Received ${sendDataResult.counts?.total || 0} perspectives from Module 3`)
        addDebugLog(`[DATA] Leftist: ${sendDataResult.counts?.leftist || 0}`)
        addDebugLog(`[DATA] Rightist: ${sendDataResult.counts?.rightist || 0}`)
        addDebugLog(`[DATA] Common: ${sendDataResult.counts?.common || 0}`)
      } else {
        addDebugLog('[SKIP] Step 1/3: Perspective files already exist in Module 4')
        addDebugLog('[INFO] Using existing data instead of fetching from Module 3')
      }
      
      if (hasBaseFiles) {
        addDebugLog('[SKIP] Step 2/3: Perspective files already exist, skipping enrichment')
        addDebugLog('[INFO] Using existing perspective data for debate')
      } else {
        setProcessingStep("Step 2/3: Enriching with web evidence (Google Search + AI verification)... This may take up to 15 minutes.")
        console.log('[Module4] Step 2/3: Enriching perspectives with web evidence...')
        addDebugLog('[STEP 2/3] Starting web enrichment process...')
        addDebugLog('[INFO] This may take up to 15 minutes')
        addDebugLog('[CONFIG] Region: India (Asia) | Method: Selenium + AI verification')
        
        const enrichResponse = await fetch("/module4/api/enrich-perspectives", {
          method: "POST",
          headers: {
            'Content-Type': 'application/json'
          }
        })
        
        console.log('[Module4] Enrichment response status:', enrichResponse.status)
        
        if (!enrichResponse.ok) {
          const errorText = await enrichResponse.text()
          console.error('[Module4] Enrichment error response:', errorText)
          console.warn('[Module4] Enrichment failed, proceeding with simple perspectives:', errorText)
          addDebugLog('[WARNING] Enrichment failed, proceeding with base perspectives')
          setProcessingStep("Step 2/3: Web enrichment skipped, using base perspectives...")
          await new Promise(resolve => setTimeout(resolve, 1500))
        } else {
          const enrichData = await enrichResponse.json()
          console.log('[Module4] Enrichment result:', enrichData)
          setEnrichmentResult(enrichData)
          const totalLinks = enrichData.total_relevant_links || enrichData.total_links_found || 0
          addDebugLog(`[SUCCESS] Enrichment complete! Found ${totalLinks} verified web sources`)
          if (enrichData.summary) {
            for (const [filename, data] of Object.entries(enrichData.summary)) {
              addDebugLog(`[DATA] ${filename}: ${(data as any).items_with_links}/${(data as any).total_items} enriched`)
            }
          }
          setProcessingStep(`Step 2/3: Enrichment complete! Found ${totalLinks} verified web sources.`)
          await new Promise(resolve => setTimeout(resolve, 2000))
        }
      }
      
      setProcessingStep("Step 3/3: Running AI agent debate (Leftist vs Rightist vs Judge)... This may take several minutes.")
      console.log('[Module4] Step 3/3: Starting debate...')
      addDebugLog('[STEP 3/3] Starting AI agent debate...')
      addDebugLog('[INFO] Running multi-round debate with Leftist, Rightist, and Judge agents')
      
      const debateResponse = await fetch("/module4/api/debate", {
        method: "POST",
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ use_enriched: true })
      })
      
      console.log('[Module4] Debate response status:', debateResponse.status)
      
      if (!debateResponse.ok) {
        const errorText = await debateResponse.text()
        console.error('[Module4] Debate error response:', errorText)
        throw new Error(`Failed to start debate: ${debateResponse.status} - ${errorText}`)
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
      saveToCache(data, enrichmentResult || undefined)
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
    console.log('[Module4] Cleared debate and enrichment results and cache')
  }

  const checkDataSent = async () => {
    // Check what data would be fetched from Module 3
    console.log('=== CHECKING MODULE 3 PERSPECTIVE DATA ===')
    
    try {
      const [leftistResponse, rightistResponse, commonResponse] = await Promise.all([
        fetch('/module3/module3/output/leftist'),
        fetch('/module3/module3/output/rightist'),
        fetch('/module3/module3/output/common')
      ])
      
      if (leftistResponse.ok && rightistResponse.ok && commonResponse.ok) {
        const leftistData = await leftistResponse.json()
        const rightistData = await rightistResponse.json()
        const commonData = await commonResponse.json()
        
        console.log('✓ Module 3 perspective data available:')
        console.log('  - Leftist perspectives:', leftistData.length)
        console.log('  - Rightist perspectives:', rightistData.length)
        console.log('  - Common perspectives:', commonData.length)
        console.log('  - Total perspectives:', leftistData.length + rightistData.length + commonData.length)
        console.log('\nSample leftist perspective:', leftistData[0])
        console.log('Sample rightist perspective:', rightistData[0])
        console.log('Sample common perspective:', commonData[0])
      } else {
        console.error('✗ Failed to fetch Module 3 data:')
        console.error('  - Leftist:', leftistResponse.status, leftistResponse.statusText)
        console.error('  - Rightist:', rightistResponse.status, rightistResponse.statusText)
        console.error('  - Common:', commonResponse.status, commonResponse.statusText)
        console.error('\nMake sure Module 3 has completed processing before starting the debate.')
      }
    } catch (error) {
      console.error('✗ Error checking Module 3 data:', error)
      console.error('Make sure Module 3 backend is running and accessible.')
    }
    
    console.log('==========================================')
  }

  const getAgentDisplay = (agent: string) => {
    if (!agent) {
      return { name: 'System', class: 'system' }
    }
    
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
          
          {/* Debate Controls */}
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
                title="Toggle debug terminal"
              >
                {showDebugTerminal ? 'Hide Terminal' : 'Show Terminal'}
              </button>
            )}
            
            {debateResult && (
              <button
                onClick={clearDebate}
                className="px-4 py-2 border border-white/20 rounded text-white/60 hover:text-white hover:border-white/40 transition-colors text-sm"
              >
                Clear
              </button>
            )}
          </div>

          {/* Backend Status */}
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

          {/* Error Display */}
          {error && (
            <div className="border border-red-500/30 bg-red-500/5 rounded p-4 mb-6">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {loading && (
            <div className="border border-blue-500/30 bg-blue-500/5 rounded p-4 mb-6">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></div>
                <span className="text-blue-400 text-sm font-medium">Processing...</span>
              </div>
              {processingStep && (
                <div className="ml-4 text-white/60 text-xs mt-1">
                  {processingStep}
                </div>
              )}
            </div>
          )}

          {((liveDebateMessages.length > 0 && !debateResult) || (debateResult && debateResult.debate_transcript)) && (
            <div className="border border-white/30 bg-black/50 rounded-lg overflow-hidden mb-6">
              <div className="bg-white/5 border-b border-white/30 px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${loading ? 'bg-white animate-pulse' : 'bg-green-400'}`}></div>
                  <span className="text-white text-sm font-medium">{loading ? 'Live Debate in Progress' : 'Debate Transcript'}</span>
                  <span className="text-white/60 text-xs ml-auto">
                    {debateResult?.debate_transcript ? debateResult.debate_transcript.length : liveDebateMessages.length} Rounds
                  </span>
                </div>
              </div>
              <div 
                ref={debateViewRef}
                className="p-4 max-h-[500px] overflow-y-auto custom-scrollbar bg-black relative"
                style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.05) 1px, transparent 0)', backgroundSize: '20px 20px' }}
              >
                {(() => {
                  const messagesToShow = debateResult?.debate_transcript || liveDebateMessages
                  return messagesToShow.length === 0 ? (
                    <div className="flex items-center justify-center py-8 text-white/60">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-white/60 animate-pulse"></div>
                        <span>Debate starting...</span>
                      </div>
                    </div>
                  ) : (
                    messagesToShow.filter(msg => msg && (msg.message || msg.argument)).map((msg, idx) => {
                      const agentInfo = getAgentDisplay(msg.agent)
                      const isLeftist = agentInfo.class === 'leftist'
                      const isRightist = agentInfo.class === 'rightist'
                      const isJudge = agentInfo.class === 'judge'
                      
                      return (
                        <div
                          key={idx}
                          className={`mb-6 animate-fade-in-up`}
                          style={{
                            animationDelay: `${idx * 0.1}s`,
                            animationFillMode: 'both'
                          }}
                        >
                          {/* Agent Header */}
                          <div className={`flex items-center gap-2 mb-2 ${isRightist ? 'justify-end' : 'justify-start'}`}>
                            <div className={`w-2 h-2 rounded-full ${
                              isLeftist ? 'bg-red-400' :
                              isRightist ? 'bg-blue-400' :
                              'bg-green-400'
                            }`}></div>
                            <span className={`text-xs font-medium uppercase tracking-wider ${
                              isLeftist ? 'text-red-400' :
                              isRightist ? 'text-blue-400' :
                              'text-green-400'
                            }`}>
                              {agentInfo.name}
                            </span>
                            <span className="text-[10px] text-white/30">Round {msg.round || (idx + 1)}</span>
                          </div>
                          
                          {/* Message Bubble */}
                          <div className={`flex ${isRightist ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[80%] rounded-2xl px-4 py-3 relative ${
                              isLeftist ? 'bg-red-500/10 border border-red-500/20 text-white/90' :
                              isRightist ? 'bg-blue-500/10 border border-blue-500/20 text-white/90' :
                              'bg-green-500/10 border border-green-500/20 text-white/90'
                            }`}>
                              {/* Chat Tail */}
                              <div className={`absolute top-3 ${
                                isRightist ? '-right-2 border-l-transparent border-t-transparent border-b-transparent border-l-white/10' :
                                '-left-2 border-r-transparent border-t-transparent border-b-transparent border-r-white/10'
                              } ${
                                isLeftist ? 'border-l-red-500/20' :
                                isRightist ? 'border-l-blue-500/20' :
                                'border-l-green-500/20'
                              } w-0 h-0 border-l-[8px] border-t-[8px] border-b-[8px]`}></div>
                              
                              <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.message || msg.argument}</p>
                              
                              {/* Timestamp */}
                              <div className={`text-[10px] mt-2 ${
                                isLeftist ? 'text-red-400/60' :
                                isRightist ? 'text-blue-400/60' :
                                'text-green-400/60'
                              }`}>
                                {new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })
                  )
                })()}
                {loading && liveDebateMessages.length > 0 && (
                  <div className="flex items-center justify-center gap-2 text-white/60 text-sm animate-pulse mt-4">
                    <div className="w-2 h-2 rounded-full bg-white/60"></div>
                    <span>Debate in progress...</span>
                  </div>
                )}
              </div>
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
                <button
                  onClick={() => setShowDebugTerminal(false)}
                  className="text-white/60 hover:text-white text-xs"
                >
                  X
                </button>
              </div>
              <div 
                ref={debugTerminalRef}
                className="p-4 font-mono text-xs text-white/90 max-h-96 overflow-y-auto custom-scrollbar bg-black"
              >
                {debugLogs.map((log, idx) => (
                  <div key={idx} className="mb-1 whitespace-pre-wrap leading-relaxed">
                    {log}
                  </div>
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

          {/* Debate Output */}
          {!debateResult && !loading && !error && (
            <div className="border border-white/10 rounded p-12 text-center">
              <svg className="w-16 h-16 mx-auto mb-4 text-white/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a2 2 0 01-2-2v-6a2 2 0 012-2h8z"></path>
              </svg>
              <p className="text-white/40 text-sm mb-2">Ready for comprehensive analysis.</p>
              <p className="text-white/30 text-xs">Click "Start Complete Analysis" to fetch data, enrich with web evidence, and run AI debate.</p>
            </div>
          )}

          {/* Debate Results Container */}
          {debateResult && (
            <div className="space-y-6">
              {/* Topic */}
              {debateResult.topic && (
                <div className="border border-white/10 rounded-lg p-4">
                  <h4 className="text-xs font-medium text-white/60 mb-2 uppercase tracking-wider">Topic</h4>
                  <p className="text-white text-sm">{debateResult.topic}</p>
                </div>
              )}

              {enrichmentResult && enrichmentResult.status === 'completed' && (
                <div className="border border-purple-500/30 bg-purple-500/5 rounded-lg p-5">
                  <h4 className="text-xs font-medium text-purple-400 mb-3 uppercase tracking-wider flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9v-9m0-9v9"></path>
                    </svg>
                    Web Evidence Enrichment
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <div className="border border-white/10 rounded-lg p-3 bg-black/20">
                      <div className="text-xs text-white/50 mb-1">Verified Sources</div>
                      <div className="text-2xl font-bold text-purple-400">
                        {enrichmentResult.total_relevant_links || enrichmentResult.total_links_found || 0}
                      </div>
                    </div>
                    <div className="border border-white/10 rounded-lg p-3 bg-black/20">
                      <div className="text-xs text-white/50 mb-1">Search Method</div>
                      <div className="text-sm font-medium text-white/80">Selenium + AI</div>
                    </div>
                    <div className="border border-white/10 rounded-lg p-3 bg-black/20">
                      <div className="text-xs text-white/50 mb-1">Region</div>
                      <div className="text-sm font-medium text-white/80">India (Asia)</div>
                    </div>
                  </div>
                  {enrichmentResult.summary && (
                    <div className="space-y-2">
                      <div className="text-xs text-white/60 mb-2">Enrichment Summary:</div>
                      {Object.entries(enrichmentResult.summary).map(([filename, data]: [string, any]) => (
                        <div key={filename} className="flex items-center justify-between text-xs border border-white/5 rounded px-3 py-2">
                          <span className="text-white/70">{filename.replace('relevant_', '').replace('.json', '')}</span>
                          <span className="text-purple-400">{data.items_with_links}/{data.total_items} enriched</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 pt-3 border-t border-white/10 text-xs text-white/50">
                    Process: Google search with Gemini AI relevance verification + trust scoring
                  </div>
                </div>
              )}

              {/* Status Message */}
              {debateResult.message && debateResult.status === 'completed' && (
                <div className="border border-green-500/30 bg-green-500/5 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                    </svg>
                    <span className="text-xs font-medium text-green-400 uppercase tracking-wider">
                      {debateResult.status}
                    </span>
                  </div>
                  <p className="text-white/70 text-sm">{debateResult.message}</p>
                </div>
              )}

              {/* Judgment */}
              {debateResult.judgment && (
                <div className="border border-purple-500/30 bg-purple-500/5 rounded-lg p-5">
                  <h4 className="text-xs font-medium text-purple-400 mb-3 uppercase tracking-wider flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                    Final Judgment
                  </h4>
                  <p className="text-white/80 text-sm leading-relaxed whitespace-pre-wrap">{debateResult.judgment}</p>
                </div>
              )}



              {/* Debate File Reference */}
              {debateResult.debate_file && (
                <div className="border border-white/10 rounded-lg p-4">
                  <div className="flex items-center gap-2 text-xs text-white/40">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                    </svg>
                    <span>Debate saved to: {debateResult.debate_file}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </ModuleLayout>
  )
}



