"use client"

import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { ModuleLayout } from "./module-layout"
import { LiquidButton } from "../ui/liquid-glass-button"
import {
  saveModule4Data,
  setCurrentModule,
  requireSessionId,
  getModule4Data
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
  enrichmentEnabled?: boolean
}

const CACHE_KEY = 'module4_debate_cache'
const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const NO_SESSION_MESSAGE = 'No active pipeline session. Run Module 1 analysis first.'

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
  const [enrichmentEnabled, setEnrichmentEnabled] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [backendStatus, setBackendStatus] = useState<string>("checking")
  const router = useRouter()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [processingStep, setProcessingStep] = useState<string>("")
  const [debugLogs, setDebugLogs] = useState<string[]>([])
  const [showDebugTerminal, setShowDebugTerminal] = useState<boolean>(false)
  const [liveDebateMessages, setLiveDebateMessages] = useState<DebateMessage[]>([])
  const [showEnrichmentItems, setShowEnrichmentItems] = useState<boolean>(false)
  const [showDebateMessages, setShowDebateMessages] = useState<boolean>(false)
  const debugTerminalRef = useRef<HTMLDivElement>(null)
  const debateViewRef = useRef<HTMLDivElement>(null)
  const debateUpdateSourceRef = useRef<EventSource | null>(null)
  const debateCompleteSourceRef = useRef<EventSource | null>(null)
  const lastMessageIndexRef = useRef<number>(0)

  const appendQueryParams = (url: string, params: Record<string, string | number | boolean>) => {
    const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
    const parsed = new URL(url, base)

    Object.entries(params).forEach(([key, value]) => {
      parsed.searchParams.set(key, String(value))
    })

    if (url.startsWith('http://') || url.startsWith('https://')) {
      return parsed.toString()
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  }

  const addDebugLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString()
    setDebugLogs(prev => [...prev, `[${timestamp}] ${message}`])
  }

  const closeDebateStreams = () => {
    if (debateUpdateSourceRef.current) {
      debateUpdateSourceRef.current.close()
      debateUpdateSourceRef.current = null
    }
    if (debateCompleteSourceRef.current) {
      debateCompleteSourceRef.current.close()
      debateCompleteSourceRef.current = null
    }
  }

  const handleToggleEnrichment = (enabled: boolean) => {
    setEnrichmentEnabled(enabled)

    if (!enabled) {
      setEnrichmentResult(null)
      setEnrichmentItems([])
      setShowEnrichmentItems(false)
    } else if (enrichmentItems.length > 0) {
      setShowEnrichmentItems(true)
    }

    try {
      saveModule4Data({
        debateResult: debateResult ?? null,
        enrichmentResult: enabled ? (enrichmentResult ?? null) : null,
        enrichmentEnabled: enabled
      })

      const cached = localStorage.getItem(CACHE_KEY)
      if (cached) {
        const cacheData: Module4Cache = JSON.parse(cached)
        cacheData.enrichmentEnabled = enabled
        if (!enabled) {
          cacheData.enrichmentResult = undefined
        }
        localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData))
      }
    } catch (error) {
      console.error('[Module4] Failed to persist enrichment preference:', error)
    }
  }

  const refreshDebateResult = async (session: string) => {
    try {
      const resultUrl = appendQueryParams('/module4/api/debate/result', { session_id: session })
      const response = await fetch(resultUrl, { cache: 'no-store' })
      if (!response.ok) {
        console.warn('[Module4] Failed to refresh debate result:', response.status)
        return null
      }
      const data = await response.json()
      if (data.status === 'completed') {
        setDebateResult(data)
      }
      return data
    } catch (error) {
      console.error('[Module4] Error refreshing debate result:', error)
      return null
    }
  }

  const setupDebateStreams = () => {
    const activeSession = sessionIdRef.current
    if (!activeSession) {
      console.warn('[Module4] Skipping SSE setup - missing session id')
      return
    }

    closeDebateStreams()
    lastMessageIndexRef.current = 0

    const updateSource = new EventSource('/api/debate-update')

    updateSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'connected') {
          return
        }
        if (data.session_id && data.session_id !== activeSession) {
          return
        }

        const index = Number(data.message_index || 0)
        if (index && index <= lastMessageIndexRef.current) {
          return
        }
        lastMessageIndexRef.current = index || lastMessageIndexRef.current + 1

        setShowDebateMessages(true)
        setLiveDebateMessages(prev => {
          const payload: DebateMessage = {
            agent: data.agent ?? 'Agent',
            agent_type: data.agent_type ?? undefined,
            message: data.argument ?? data.message ?? '',
            round: data.round ?? prev.length + 1
          }
          return [...prev, payload]
        })
      } catch (error) {
        console.error('[Module4] SSE update parsing error:', error)
      }
    }

    updateSource.onerror = (error) => {
      console.error('[Module4] SSE update error:', error)
    }

    debateUpdateSourceRef.current = updateSource

    const completeSource = new EventSource('/api/debate-complete')

    completeSource.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'connected') {
          return
        }
        if (data.session_id && data.session_id !== activeSession) {
          return
        }

        closeDebateStreams()

        if (data.type === 'failed') {
          setProcessingStep('')
          setLoading(false)
          setError(data.error ?? 'Debate failed to complete')
          return
        }

        setProcessingStep('Finalizing debate results...')
        const refreshed = await refreshDebateResult(activeSession)
        if (refreshed && refreshed.status === 'completed') {
          addDebugLog(`[RESULT] Final trust score: ${refreshed.trust_score ?? 'N/A'}`)
          saveToCache(refreshed, enrichmentResult ?? undefined)
          saveModule4Data({
            debateResult: refreshed,
            enrichmentResult: enrichmentResult,
            enrichmentEnabled
          })
        }
        setProcessingStep('')
        setLoading(false)
      } catch (error) {
        console.error('[Module4] SSE completion parsing error:', error)
        setProcessingStep('')
        setLoading(false)
      }
    }

    completeSource.onerror = (error) => {
      console.error('[Module4] SSE completion error:', error)
    }

    debateCompleteSourceRef.current = completeSource
  }

  const loadFromCache = async () => {
    try {
      const activeSession = sessionIdRef.current
      if (!activeSession) {
        console.warn('[Module4] Skipping cache load - session id unavailable')
        return
      }

      const cached = localStorage.getItem(CACHE_KEY)
      
      if (!cached) {
        console.log('[Module4] No cache found - starting fresh')
        return
      }

      const cacheData: Module4Cache = JSON.parse(cached)
      const age = Date.now() - cacheData.timestamp
      
      if (age >= CACHE_EXPIRY_MS) {
        console.log('[Module4] Cache expired')
        localStorage.removeItem(CACHE_KEY)
        return
      }

      const preference = typeof cacheData.enrichmentEnabled === 'boolean' ? cacheData.enrichmentEnabled : null
      if (preference !== null) {
        setEnrichmentEnabled(preference)
        if (!preference) {
          setShowEnrichmentItems(false)
        }
      }
      const effectivePreference = preference !== null ? preference : enrichmentEnabled

      console.log('[Module4] Loading from cache:', cacheData.debateResult)
      setDebateResult(cacheData.debateResult)
      
      if (effectivePreference && cacheData.enrichmentResult) {
        setEnrichmentResult(cacheData.enrichmentResult)
        setShowEnrichmentItems(true)
      }
      
      if (cacheData.debateResult.debate_transcript && Array.isArray(cacheData.debateResult.debate_transcript) && cacheData.debateResult.debate_transcript.length > 0) {
        const messagesWithType = cacheData.debateResult.debate_transcript.map(msg => {
          if (!msg.agent_type && msg.agent) {
            const agentLower = msg.agent.toLowerCase()
            if (agentLower.includes('leftist') || agentLower.includes('left')) {
              return { ...msg, agent_type: 'leftist' }
            } else if (agentLower.includes('rightist') || agentLower.includes('right')) {
              return { ...msg, agent_type: 'rightist' }
            } else if (agentLower.includes('judge') || agentLower.includes('moderator')) {
              return { ...msg, agent_type: 'judge' }
            }
          }
          return msg
        })
        
        setShowDebateMessages(true)
        
        try {
          for (let i = 0; i < messagesWithType.length; i++) {
            setLiveDebateMessages(messagesWithType.slice(0, i + 1))
            await new Promise(resolve => setTimeout(resolve, 500))
          }
        } catch (animError) {
          console.error('[Module4] Cache animation error:', animError)
          // Fallback: show all messages immediately
          setLiveDebateMessages(messagesWithType)
        }
      }
      
      if (effectivePreference) {
        try {
          const itemsUrl = appendQueryParams('/module4/api/enrichment-items', { session_id: activeSession })
          const itemsResponse = await fetch(itemsUrl, { cache: 'no-store' })
          if (itemsResponse.ok) {
            const itemsData = await itemsResponse.json()
            if (itemsData.items && Array.isArray(itemsData.items)) {
              setEnrichmentItems(itemsData.items)
            }
          }
        } catch (err) {
          console.error('[Module4] Error loading enrichment items:', err)
        }
      }
      
      saveModule4Data({
        debateResult: cacheData.debateResult,
        enrichmentResult: effectivePreference ? (cacheData.enrichmentResult ?? null) : null,
        enrichmentEnabled: effectivePreference
      })
    } catch (error) {
      console.error('[Module4] Error loading cache:', error)
    }
  }

  const saveToCache = (result: DebateResult, enrichment?: EnrichmentResult) => {
    try {
      const cacheData: Module4Cache = {
        debateResult: result,
        enrichmentResult: enrichmentEnabled && enrichment ? enrichment : undefined,
        timestamp: Date.now(),
        inputHash: Date.now().toString(),
        enrichmentEnabled
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

  // Removed problematic cache check that was clearing state on every render
  // The cache is now handled properly in startDebateProcess and loadFromCache

  // ONLY run on mount, client-side only
  useEffect(() => {
    setCurrentModule(4)

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

    try {
      const activeSessionId = requireSessionId()
      setSessionId(activeSessionId)
      sessionIdRef.current = activeSessionId
    } catch (error) {
      console.error('[Module4] No active session available', error)
      setSessionError(NO_SESSION_MESSAGE)
      setError(NO_SESSION_MESSAGE)
    }

    return () => {
      if (document.head.contains(style)) {
        document.head.removeChild(style)
      }
    }
  }, [])

  useEffect(() => {
    try {
      const stored = getModule4Data()
      if (stored?.enrichmentEnabled !== undefined) {
        setEnrichmentEnabled(stored.enrichmentEnabled)
        if (!stored.enrichmentEnabled) {
          setShowEnrichmentItems(false)
        }
      }
    } catch (err) {
      console.error('[Module4] Failed to restore enrichment preference:', err)
    }
  }, [])

  useEffect(() => {
    return () => {
      closeDebateStreams()
    }
  }, [])

  useEffect(() => {
    sessionIdRef.current = sessionId
    if (!sessionId) {
      return
    }

    if (sessionError) {
      setSessionError(null)
      setError(null)
    }

    checkBackendHealth()
    loadFromCache()
  }, [sessionId, sessionError])

  // Auto-scroll to latest message in debate view
  useEffect(() => {
    if (debateViewRef.current && liveDebateMessages.length > 0) {
      debateViewRef.current.scrollTo({
        top: debateViewRef.current.scrollHeight,
        behavior: 'smooth'
      })
    }
  }, [liveDebateMessages])

  // Auto-focus on debate container when it first appears
  useEffect(() => {
    if (showDebateMessages && debateViewRef.current) {
      const container = debateViewRef.current.parentElement
      if (container) {
        setTimeout(() => {
          container.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }, 100)
      }
    }
  }, [showDebateMessages])

  const startDebateProcess = async () => {
    setLoading(true)
    setError(null)
    setDebateResult(null)
    
    const hasExistingEnrichment = enrichmentResult !== null || enrichmentItems.length > 0
    const shouldUseEnrichment = enrichmentEnabled
    const hadCachedEnrichment = shouldUseEnrichment && hasExistingEnrichment

    if (!shouldUseEnrichment) {
      setEnrichmentResult(null)
      setEnrichmentItems([])
      setShowEnrichmentItems(false)
    } else if (!hadCachedEnrichment) {
      setEnrichmentResult(null)
      setEnrichmentItems([])
      setShowEnrichmentItems(false)
    } else if (enrichmentItems.length > 0) {
      setShowEnrichmentItems(true)
    }
    
    setLiveDebateMessages([])
    setShowDebateMessages(false)
    setProcessingStep("")
    setDebugLogs([])
    setShowDebugTerminal(true)
    lastMessageIndexRef.current = 0
    closeDebateStreams()
    setupDebateStreams()
    let latestEnrichment: EnrichmentResult | null = hadCachedEnrichment ? enrichmentResult : null
    let enrichmentWasUsed = hadCachedEnrichment
    
    try {
      console.log('[Module4] Starting complete debate process...')
      addDebugLog('[INFO] Starting complete debate process')
      
      // Step 1: Fetch perspectives from Module 3
      setProcessingStep("Step 1/3: Fetching perspectives from Module 3...")
      console.log('[Module4] Step 1/3: Requesting Module 3 to send perspective data to Module 4...')
      addDebugLog('[STEP 1/3] Fetching perspectives from Module 3...')
      
      const activeSession = sessionIdRef.current
      if (!activeSession) {
        addDebugLog('[ERROR] No active session id available - aborting process')
        setSessionError(NO_SESSION_MESSAGE)
        throw new Error(NO_SESSION_MESSAGE)
      }

      const sendDataResponse = await fetch('/module3/api/send_to_module4', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ session_id: activeSession })
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
      let total = counts.total || 0
      let leftist = counts.leftist || 0
      let rightist = counts.rightist || 0
      let common = counts.common || 0

      // If Module 3 didn't include counts in the response, fetch output directly for accurate stats
      if (total === 0 && leftist === 0 && rightist === 0 && common === 0) {
        try {
          const outputUrl = appendQueryParams('/module3/api/output', { session_id: activeSession })
          const outputResponse = await fetch(outputUrl, { cache: 'no-store' })
          if (outputResponse.ok) {
            const outputData = await outputResponse.json()
            const finalOutput = outputData?.final_output || {}

            const derivedLeftist = Array.isArray(finalOutput.leftist) ? finalOutput.leftist.length : 0
            const derivedRightist = Array.isArray(finalOutput.rightist) ? finalOutput.rightist.length : 0
            const derivedCommon = Array.isArray(finalOutput.common) ? finalOutput.common.length : 0
            const perspectiveCount = Array.isArray(outputData?.perspectives) ? outputData.perspectives.length : 0

            leftist = derivedLeftist
            rightist = derivedRightist
            common = derivedCommon
            total = perspectiveCount || derivedLeftist + derivedRightist + derivedCommon
          }
        } catch (fetchErr) {
          console.warn('[Module4] Unable to derive Module 3 perspective counts:', fetchErr)
        }
      }
      
      addDebugLog(`[SUCCESS] Received ${total} perspectives from Module 3`)
      addDebugLog(`[DATA] Leftist: ${leftist}`)
      addDebugLog(`[DATA] Rightist: ${rightist}`)
      addDebugLog(`[DATA] Common: ${common}`)
      
      // Step 2: Enrich perspectives with web evidence
      if (!shouldUseEnrichment) {
        setProcessingStep("Step 2/3: Skipping web enrichment (user preference - faster debate)")
        addDebugLog('[STEP 2/3] Enrichment disabled by user preference')
        addDebugLog('[INFO] Proceeding directly with Module 3 perspectives')
        await new Promise(resolve => setTimeout(resolve, 800))
      } else if (hadCachedEnrichment) {
        setProcessingStep("Step 2/3: Using cached enrichment data (skipping web search)...")
        console.log('[Module4] Step 2/3: Skipping enrichment, using existing data')
        addDebugLog('[STEP 2/3] Using cached enrichment data')
        addDebugLog('[INFO] Skipping web enrichment - already have enriched data')

        const cachedLinks = enrichmentResult?.total_relevant_links || enrichmentResult?.total_links_found || enrichmentItems.length
        addDebugLog(`[SUCCESS] Using ${cachedLinks} verified web sources from cache`)

        enrichmentWasUsed = true
        latestEnrichment = enrichmentResult ?? latestEnrichment

        if (enrichmentItems.length > 0) {
          setShowEnrichmentItems(true)
        }

        await new Promise(resolve => setTimeout(resolve, 1000))
      } else {
        setProcessingStep("Step 2/3: Enriching with web evidence (Google Search + AI verification)... This may take up to 15 minutes.")
        console.log('[Module4] Step 2/3: Enriching perspectives with web evidence...')
        addDebugLog('[STEP 2/3] Starting web enrichment process...')
        addDebugLog('[INFO] This may take up to 15 minutes')
        addDebugLog('[CONFIG] Region: India (Asia) | Method: Selenium + AI verification')

        try {
          const enrichUrl = appendQueryParams('/module4/api/enrich-perspectives', {
            session_id: activeSession,
          })
          addDebugLog('[INFO] Calling enrichment endpoint...')

          const controller = new AbortController()
          const enrichResponse = await fetch(enrichUrl, {
            method: "POST",
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-store',
            signal: controller.signal,
            keepalive: true,
          })

          if (enrichResponse.ok) {
            const enrichData = await enrichResponse.json()

            if (enrichData.status === "completed") {
              latestEnrichment = enrichData
              enrichmentWasUsed = true
              setEnrichmentResult(enrichData)
              const totalLinks = enrichData.total_relevant_links || enrichData.total_links_found || 0
              addDebugLog(`[SUCCESS] Enrichment completed with ${totalLinks} verified web sources`)
              setProcessingStep(`Step 2/3: Enrichment complete! Found ${totalLinks} verified web sources.`)

              addDebugLog('[INFO] Fetching enrichment items for display...')
              try {
                const itemsUrl = appendQueryParams('/module4/api/enrichment-items', {
                  session_id: activeSession,
                })
                const itemsResponse = await fetch(itemsUrl, { cache: 'no-store' })
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
      
      // Show debate section immediately to indicate debate is starting
      setShowDebateMessages(true)
      setLiveDebateMessages([])
      
      // Try multiple times to guard against transient orchestrator issues
      let debateResponse: Response | null = null
      let lastError: Error | null = null
      
      const debateUrl = appendQueryParams('/module4/api/debate', {
        session_id: activeSession,
        use_enriched: enrichmentWasUsed,
      })

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          addDebugLog(`[ATTEMPT ${attempt}/3] Calling debate endpoint...`)
          
          // First 2 attempts: use Next.js rewrite
          // Last attempt repeats via orchestrator in case of transient failures
          const url = debateUrl
          
          console.log(`[Module4] Attempt ${attempt}: Calling ${url}`)
          
          debateResponse = await fetch(url, {
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
      
      // Set debate result immediately so trust score shows up
      setDebateResult(data)
      addDebugLog(`[RESULT] Final trust score: ${data.trust_score || 'N/A'}`)
      
      if (lastMessageIndexRef.current === 0) {
        // Fallback when live stream failed
        addDebugLog('[INFO] Fetching debate messages for display...')
        try {
          const messagesUrl = appendQueryParams('/module4/api/debate-messages', {
            session_id: activeSession,
          })
          const messagesResponse = await fetch(messagesUrl, { cache: 'no-store' })
          if (messagesResponse.ok) {
            const messagesData = await messagesResponse.json()
            if (messagesData.status === "completed" && Array.isArray(messagesData.messages)) {
              const allMessages = messagesData.messages
              addDebugLog(`[INFO] Rendering ${allMessages.length} debate messages (fallback)`)
              setShowDebateMessages(true)
              setLiveDebateMessages(allMessages)
            } else {
              addDebugLog('[WARN] No messages found in response (fallback)')
            }
          } else {
            addDebugLog('[WARN] Failed to fetch debate messages (fallback)')
          }
        } catch (err) {
          console.error('[Module4] Failed to fetch debate messages:', err)
          addDebugLog('[ERROR] Could not load debate messages for display')
        }
      }
      
      // Save to cache and session
      addDebugLog('[INFO] Saving results and cache...')
      const enrichmentPayload = enrichmentWasUsed ? (latestEnrichment ?? enrichmentResult ?? null) : null
      saveToCache(data, enrichmentPayload || undefined)
      saveModule4Data({
        debateResult: data,
        enrichmentResult: enrichmentPayload,
        enrichmentEnabled
      })
      
      setProcessingStep("")
      addDebugLog('[COMPLETE] All steps completed successfully!')
      closeDebateStreams()
    } catch (err) {
      console.error('[Module4] Debate error:', err)
      addDebugLog(`[ERROR] ${err instanceof Error ? err.message : 'Unknown error'}`)
      setError(err instanceof Error ? err.message : "Failed to connect to Module 4 backend")
      setProcessingStep("")
      closeDebateStreams()
      
      // Ensure UI is still visible even on error
      if (debateResult) {
        addDebugLog('[INFO] Results were saved before error occurred')
      }
    } finally {
      setLoading(false)
      console.log('[Module4] Process completed, loading state cleared')
    }
  }

  const clearDebate = () => {
    setDebateResult(null)
    setLiveDebateMessages([])
    setShowDebateMessages(false)
    setError(null)
    console.log('[Module4] Cleared debate display (cache and enrichment data preserved)')
  }

  // Helper function for agent display (unused but kept for future use)
  // const getAgentDisplay = (agent: string) => {
  //   if (!agent) return { name: 'System', class: 'system' }
  //   const lowerAgent = agent.toLowerCase()
  //   if (lowerAgent.includes('leftist') || lowerAgent.includes('left')) {
  //     return { name: 'Leftist Agent', class: 'leftist' }
  //   } else if (lowerAgent.includes('rightist') || lowerAgent.includes('right')) {
  //     return { name: 'Rightist Agent', class: 'rightist' }
  //   } else if (lowerAgent.includes('judge') || lowerAgent.includes('moderator')) {
  //     return { name: 'Judge AI', class: 'judge' }
  //   } else {
  //     return { name: 'System', class: 'system' }
  //   }
  // }

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
              <span className="text-white">&ldquo;AI can never be sure if information is true, only humans can.&rdquo;</span>
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

          <div className="border border-white/10 rounded-lg p-5 mb-6 bg-white/5">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-4 h-4 text-cyan-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 6v6l4 2" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 3a9 9 0 100 18 9 9 0 000-18z" />
                  </svg>
                  <span className="text-sm font-medium text-white/80">Evidence Enrichment</span>
                </div>
                <p className="text-xs text-white/50 leading-relaxed">
                  When enabled, Module 4 gathers supporting web evidence before the debate. Expect higher confidence scores but runs can take up to 15 minutes. Disable it to jump straight into the debate using Module 3 perspectives only.
                </p>
              </div>
              <div className="flex items-center gap-3 self-start md:self-center">
                <span className={`text-xs font-medium ${enrichmentEnabled ? 'text-cyan-300' : 'text-white/40'}`}>
                  {enrichmentEnabled ? 'Enabled' : 'Disabled'}
                </span>
                <button
                  type="button"
                  onClick={() => handleToggleEnrichment(!enrichmentEnabled)}
                  aria-pressed={enrichmentEnabled}
                  disabled={loading}
                  className={`relative inline-flex h-6 w-12 items-center rounded-full transition-colors duration-200 ${
                    enrichmentEnabled ? 'bg-cyan-500/80' : 'bg-white/20'
                  } ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 ${
                      enrichmentEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
            {!enrichmentEnabled && (
              <p className="mt-3 text-xs text-white/40">
                Web lookups are skipped. The debate starts immediately and relies on Module 3 clusters only.
              </p>
            )}
          </div>
          
          {/* Controls */}
          <div className="flex gap-3 mb-6">
            <LiquidButton 
              onClick={startDebateProcess} 
              disabled={loading || backendStatus !== "ready" || !sessionId}
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

          {/* Debate Messages Display (Animated Messenger Style) */}
          {showDebateMessages && (
            <div className="border border-purple-500/30 bg-purple-500/5 rounded-lg p-6 mb-6 animate-fade-in-up">
              <div className="flex items-center gap-2 mb-4">
                <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path>
                </svg>
                <h4 className="text-sm font-medium text-purple-400 uppercase tracking-wider">
                  {liveDebateMessages.length > 0 ? 'AI Debate in Progress' : 'Starting AI Debate...'}
                </h4>
                {liveDebateMessages.length > 0 && (
                  <span className="text-xs text-white/40 ml-auto">{liveDebateMessages.length} messages</span>
                )}
                {liveDebateMessages.length === 0 && loading && (
                  <div className="ml-auto flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse"></div>
                    <span className="text-xs text-purple-400">Debate running in background...</span>
                  </div>
                )}
              </div>
              <div ref={debateViewRef} className="space-y-3 max-h-[500px] overflow-y-auto custom-scrollbar bg-black/20 rounded-lg p-4">
                {liveDebateMessages.length === 0 && loading && (
                  <div className="flex items-center justify-center py-12">
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-2 mb-3">
                        <div className="w-3 h-3 rounded-full bg-purple-400 animate-pulse"></div>
                        <div className="w-3 h-3 rounded-full bg-purple-400 animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                        <div className="w-3 h-3 rounded-full bg-purple-400 animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                      </div>
                      <p className="text-purple-300 text-sm font-medium">AI agents are debating...</p>
                      <p className="text-white/40 text-xs mt-1">Messages will appear here as they are generated</p>
                    </div>
                  </div>
                )}
                {liveDebateMessages.map((msg, idx) => {
                  const isLeftist = msg.agent_type === 'leftist'
                  const isRightist = msg.agent_type === 'rightist'
                  const isJudge = msg.agent_type === 'judge'
                  
                  return (
                    <div key={idx} className={`flex ${isJudge ? 'justify-center' : isRightist ? 'justify-end' : 'justify-start'} animate-fade-in-up`} style={{ animationDelay: `${idx * 0.1}s` }}>
                      <div className={`max-w-[70%] rounded-2xl px-4 py-3 backdrop-blur-sm ${
                        isLeftist ? 'bg-blue-500/20 border border-blue-500/30 text-blue-100' :
                        isRightist ? 'bg-red-500/20 border border-red-500/30 text-red-100' :
                        isJudge ? 'bg-green-500/20 border border-green-500/30 text-green-100' :
                        'bg-white/10 border border-white/20 text-white/80'
                      }`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs font-semibold ${
                            isLeftist ? 'text-blue-300' :
                            isRightist ? 'text-red-300' :
                            isJudge ? 'text-green-300' :
                            'text-white/60'
                          }`}>
                            {msg.agent}
                          </span>
                          {msg.round && msg.round > 0 && (
                            <span className="text-xs text-white/40">
                              Round {msg.round}
                            </span>
                          )}
                        </div>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.message || msg.argument || 'No content'}</p>
                      </div>
                    </div>
                  )
                })}
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

          {/* Results placeholder */}
          {!debateResult && !loading && !error && !showEnrichmentItems && !showDebateMessages && (
            <div className="border border-white/10 rounded p-12 text-center">
              <svg className="w-16 h-16 mx-auto mb-4 text-white/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a2 2 0 01-2-2v-6a2 2 0 012-2h8z"></path>
              </svg>
              <p className="text-white/40 text-sm mb-2">Ready for comprehensive analysis.</p>
              <p className="text-white/30 text-xs">Click &ldquo;Start Complete Analysis&rdquo; to fetch data, enrich with web evidence, and run AI debate.</p>
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

              <div className="flex justify-end pt-2">
                <button
                  onClick={() => router.push('/modules/5')}
                  className="px-4 py-2 text-sm border border-white/20 text-white/70 hover:text-white hover:border-white/40 rounded transition-colors"
                >
                  View Module 5 Summary →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </ModuleLayout>
  )
}