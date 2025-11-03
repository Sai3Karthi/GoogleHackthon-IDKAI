"use client"

import { ModuleLayout } from "./module-layout"
import { useState, useEffect, useRef } from "react"
import { TextShimmer } from "@/components/ui/text-shimmer"
import { PerspectiveCarousel } from "./module-3-carousel"
import {
  generateInputHash,
  savePerspectivesToCache,
  loadPerspectivesFromCache,
  hasCacheForHash,
  clearCacheForHash,
  cleanupExpiredCaches
} from "@/lib/cache-manager"
import {
  saveModule3Data,
  getModule3Data,
  setCurrentModule,
  getModule4Data,
  getFinalAnalysisData,
  isPipelineCompleted
} from "@/lib/session-manager"

interface Perspective {
  color: string
  bias_x: number
  significance_y: number
  text: string
}

export function Module3() {
  const [inputData, setInputData] = useState<any>(null)
  const [perspectives, setPerspectives] = useState<Perspective[]>([])
  const [finalOutput, setFinalOutput] = useState<{
    leftist: Perspective[]
    rightist: Perspective[]
    common: Perspective[]
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [isGenerating, setIsGenerating] = useState(false)
  const [showGraph, setShowGraph] = useState(false)
  const [backendRunning, setBackendRunning] = useState(false)
  const [startingBackend, setStartingBackend] = useState(false)
  const [isFromCache, setIsFromCache] = useState(false)
  const [currentInputHash, setCurrentInputHash] = useState<string>("")
  const [showMethodology, setShowMethodology] = useState(false)
  const [hoveredPerspective, setHoveredPerspective] = useState<Perspective | null>(null)
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [showOutputGraph, setShowOutputGraph] = useState(false)
  const [loadingOutputGraph, setLoadingOutputGraph] = useState(false)
  const graphRef = useRef<HTMLDivElement>(null)
  const outputGraphRef = useRef<HTMLDivElement>(null)
  const autoAdvanceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showClusteringDetails, setShowClusteringDetails] = useState(false)
  const [autoAdvanceTriggered, setAutoAdvanceTriggered] = useState(false)
  const statusPollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [redirectCountdown, setRedirectCountdown] = useState<number | null>(null)
  const redirectTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [isRestoringFromSession, setIsRestoringFromSession] = useState(false)

  const steps = [
    { name: "Input", description: "Receive topic and significance score from Module 2" },
    { name: "Perspective Generation", description: "AI generates multiple perspectives across bias spectrum" },
    { name: "Visualisation", description: "Graph showing bias vs significance for all perspectives" },
    { name: "Output", description: "Three JSON files ready for Module 4" },
  ]

  // Hardcoded input data as fallback (from input.json)
  const fallbackInput = {
    topic: "Charles James Kirk (October 14, 1993 – September 10, 2025)",
    text: "Charles James Kirk (October 14, 1993 – September 10, 2025) was an American right-wing political activist, entrepreneur, and media personality who rose to prominence as a leading voice in the MAGA movement. Born in Arlington Heights, Illinois, he dedicated himself to political activism after a brief stint at Harper College. Kirk co-founded Turning Point USA (TPUSA) in 2012 and served as its executive director, establishing the organization as a significant force in conservative youth activism...",
    significance_score: 0.75
  }

  useEffect(() => {
    // Set current module
    setCurrentModule(3)
    
    // Cleanup expired caches on mount
    cleanupExpiredCaches()
    
    // Try to restore from session first
    const sessionData = getModule3Data()
    if (sessionData && sessionData.perspectives.length > 0) {
      console.log('[Module3] Restoring from session:', sessionData.perspectives.length, 'perspectives')
      // Set restoration flag FIRST to prevent countdown
      setIsRestoringFromSession(true)
      // Then set all other state
      setTimeout(() => {
        setPerspectives(sessionData.perspectives)
        setFinalOutput(sessionData.finalOutput)
        setCurrentInputHash(sessionData.inputHash)
        setIsFromCache(true)
        setCurrentStep(3)
        setShowGraph(true)
        setShowOutputGraph(true)
        setAutoAdvanceTriggered(true)
        setBackendRunning(true)
        // Still load input data for display
        fetchInputData().catch(console.error)
      }, 0)
      return
    }
    
    // Load input data from backend via GET request
    const loadInputData = async () => {
      try {
        const response = await fetch("/module3/api/input")
        if (response.ok) {
          const input = await response.json()
          setInputData(input)
          
          // Generate hash for this input
          const hash = generateInputHash({
            topic: input.topic,
            text: input.text
          })
          setCurrentInputHash(hash)
          
          // Try to load from cache
          const cached = loadPerspectivesFromCache(hash)
          if (cached) {
            console.log('[Module3] Loading from cache:', cached.perspectives.length, 'perspectives')
            setIsRestoringFromSession(true)
            setPerspectives(cached.perspectives)
            setFinalOutput(cached.finalOutput)
            setIsFromCache(true)
            setCurrentStep(3)
            setShowGraph(true)
            setShowOutputGraph(true)
            setAutoAdvanceTriggered(true)
            setBackendRunning(true)
            console.log('[Module3] Cache loaded successfully')
          } else {
            // No cache - check if backend is processing
            console.log('[Module3] No cache found, checking backend status...')
            setIsFromCache(false)
            setIsRestoringFromSession(false)
            setBackendRunning(true)
            checkBackendStatusAndResume()
          }
        } else {
          // Fallback to hardcoded input if backend not available
          console.log("Backend not available, using fallback input")
          setInputData(fallbackInput)
          
          const hash = generateInputHash({
            topic: fallbackInput.topic,
            text: fallbackInput.text
          })
          setCurrentInputHash(hash)
          
          const cached = loadPerspectivesFromCache(hash)
          if (cached) {
            console.log('[Module3] Loading from cache (fallback):', cached.perspectives.length, 'perspectives')
            setPerspectives(cached.perspectives)
            setFinalOutput(cached.finalOutput)
            setIsFromCache(true)
            setCurrentStep(3)
            setShowGraph(true)
            setShowOutputGraph(true)
            setAutoAdvanceTriggered(true)
            console.log('[Module3] Cache loaded successfully (fallback)')
          } else {
            setIsFromCache(false)
            console.log('[Module3] No cache found for hash (fallback):', hash)
          }
          
          setBackendRunning(false)
        }
      } catch (error) {
        console.error("Error loading input data:", error)
        setInputData(fallbackInput)
        setBackendRunning(false)
        
        const hash = generateInputHash({
          topic: fallbackInput.topic,
          text: fallbackInput.text
        })
        setCurrentInputHash(hash)
        
        const cached = loadPerspectivesFromCache(hash)
        if (cached) {
          setIsRestoringFromSession(true)
          setPerspectives(cached.perspectives)
          setFinalOutput(cached.finalOutput)
          setIsFromCache(true)
          setCurrentStep(3)
          setShowGraph(true)
          setShowOutputGraph(true)
          setAutoAdvanceTriggered(true)
        } else {
          setIsFromCache(false)
          setIsRestoringFromSession(false)
        }
      }
    }
    
    loadInputData()
    
    // Cleanup polling on unmount
    return () => {
      if (statusPollingRef.current) {
        clearInterval(statusPollingRef.current)
        statusPollingRef.current = null
      }
    }
  }, [])

  // Handle ESC key for methodology modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showMethodology) {
        setShowMethodology(false)
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [showMethodology])

  // Trigger output graph loading animation when reaching Step 3
  useEffect(() => {
    const fetchFinalOutputFromBackend = async () => {
      if (currentStep === 3 && !finalOutput && perspectives.length > 0) {
        try {
          const [leftistRes, commonRes, rightistRes] = await Promise.all([
            fetch('/module3/module3/output/leftist'),
            fetch('/module3/module3/output/common'),
            fetch('/module3/module3/output/rightist')
          ])
          
          if (leftistRes.ok && commonRes.ok && rightistRes.ok) {
            const leftist = await leftistRes.json()
            const common = await commonRes.json()
            const rightist = await rightistRes.json()
            
            setFinalOutput({
              leftist: Array.isArray(leftist) ? leftist : [],
              common: Array.isArray(common) ? common : [],
              rightist: Array.isArray(rightist) ? rightist : []
            })
          } else {
            const LEFTIST_THRESHOLD = 0.428
            const RIGHTIST_THRESHOLD = 0.571
            const leftist = perspectives.filter((p: Perspective) => p.bias_x < LEFTIST_THRESHOLD)
            const rightist = perspectives.filter((p: Perspective) => p.bias_x >= RIGHTIST_THRESHOLD)
            const common = perspectives.filter((p: Perspective) => p.bias_x >= LEFTIST_THRESHOLD && p.bias_x < RIGHTIST_THRESHOLD)
            
            setFinalOutput({ leftist, rightist, common })
          }
        } catch (error) {
          const LEFTIST_THRESHOLD = 0.428
          const RIGHTIST_THRESHOLD = 0.571
          const leftist = perspectives.filter((p: Perspective) => p.bias_x < LEFTIST_THRESHOLD)
          const rightist = perspectives.filter((p: Perspective) => p.bias_x >= RIGHTIST_THRESHOLD)
          const common = perspectives.filter((p: Perspective) => p.bias_x >= LEFTIST_THRESHOLD && p.bias_x < RIGHTIST_THRESHOLD)
          
          setFinalOutput({ leftist, rightist, common })
        }
      }
    }

    fetchFinalOutputFromBackend()
    
    if (currentStep === 3 && finalOutput && !showOutputGraph) {
      setLoadingOutputGraph(true)
      setShowOutputGraph(false)
      
      setTimeout(() => {
        setLoadingOutputGraph(false)
        setShowOutputGraph(true)
      }, 1500)
    }
    
    if (currentStep !== 3 && showOutputGraph) {
      setShowOutputGraph(false)
      setLoadingOutputGraph(false)
    }
  }, [currentStep, finalOutput, showOutputGraph, perspectives])

  useEffect(() => {
    if (autoAdvanceTimeoutRef.current) {
      clearTimeout(autoAdvanceTimeoutRef.current)
      autoAdvanceTimeoutRef.current = null
    }

    // Only auto-advance during fresh generation, not when restoring from session
    if (currentStep === 2 && perspectives.length > 0 && !autoAdvanceTriggered && !isRestoringFromSession) {
      autoAdvanceTimeoutRef.current = setTimeout(() => {
        setCurrentStep(3)
        setAutoAdvanceTriggered(true)
      }, 5000)
    }

    return () => {
      if (autoAdvanceTimeoutRef.current) {
        clearTimeout(autoAdvanceTimeoutRef.current)
        autoAdvanceTimeoutRef.current = null
      }
    }
  }, [currentStep, perspectives.length, autoAdvanceTriggered, isRestoringFromSession])

  // Redirect countdown to Module 4 after output is shown (only during fresh generation, not restoration)
  useEffect(() => {
    // Don't start countdown if restoring from session or cache
    if (isRestoringFromSession || isFromCache) {
      console.log('[Module3] Skipping countdown - viewing cached/session data')
      return
    }
    
    if (currentStep === 3 && finalOutput && showOutputGraph && redirectCountdown === null) {
      // Start countdown immediately when output is shown during fresh generation
      console.log('[Module3] Starting redirect countdown to Module 4')
      setRedirectCountdown(5)

      redirectTimerRef.current = setInterval(() => {
        setRedirectCountdown((prev) => {
          if (prev === null || prev <= 1) {
            if (redirectTimerRef.current) {
              clearInterval(redirectTimerRef.current)
              redirectTimerRef.current = null
            }
            console.log('[Module3] Redirecting to Module 4')
            setCurrentModule(4)
            window.location.href = "/modules/4"
            return null
          }
          return prev - 1
        })
      }, 1000)
    }

    return () => {
      if (redirectTimerRef.current) {
        clearInterval(redirectTimerRef.current)
        redirectTimerRef.current = null
      }
    }
  }, [currentStep, finalOutput, showOutputGraph, isRestoringFromSession, isFromCache])

  useEffect(() => {
    if (currentStep !== 3 && showClusteringDetails) {
      setShowClusteringDetails(false)
    }
  }, [currentStep, showClusteringDetails])

  useEffect(() => {
    if (currentStep === 3 && !autoAdvanceTriggered && perspectives.length > 0) {
      setAutoAdvanceTriggered(true)
    }
  }, [currentStep, autoAdvanceTriggered, perspectives.length])

  const checkBackendStatusAndResume = async () => {
    try {
      const statusResponse = await fetch("/module3/api/status", { 
        method: 'GET',
        signal: AbortSignal.timeout(2000)
      })
      
      if (!statusResponse.ok) {
        console.log('[Module3] Backend not responding')
        setBackendRunning(false)
        setCurrentStep(0)
        return
      }
      
      const status = await statusResponse.json()
      console.log('[Module3] Backend status:', status)
      
      setBackendRunning(true)
      
      // Resume based on backend state
      if (status.status === 'completed' && status.pipeline_complete) {
        console.log('[Module3] Pipeline already completed, loading results...')
        await loadCompletedResults()
      } else if (status.status === 'processing') {
        console.log('[Module3] Pipeline in progress, resuming UI...')
        setCurrentStep(1)
        setIsGenerating(true)
        setLoading(true)
        setupEventListeners()
        startStatusPolling()
      } else {
        console.log('[Module3] Backend idle, ready for generation')
        setCurrentStep(0)
      }
    } catch (error) {
      console.error('[Module3] Error checking backend status:', error)
      setBackendRunning(false)
      setCurrentStep(0)
    }
  }

  const loadCompletedResults = async () => {
    try {
      // Fetch output.json
      const outputResponse = await fetch("/module3/api/output")
      if (outputResponse.ok) {
        const outputData = await outputResponse.json()
        if (outputData.perspectives && Array.isArray(outputData.perspectives)) {
          setPerspectives(outputData.perspectives)
          setCurrentStep(2)
          setShowGraph(true)
          
          // Fetch final clustered output
          const [leftistRes, commonRes, rightistRes] = await Promise.all([
            fetch("/module3/module3/output/leftist"),
            fetch("/module3/module3/output/common"),
            fetch("/module3/module3/output/rightist")
          ])
          
          if (leftistRes.ok && commonRes.ok && rightistRes.ok) {
            const leftist = await leftistRes.json()
            const common = await commonRes.json()
            const rightist = await rightistRes.json()
            
            const clusteredOutput = { leftist, common, rightist }
            setFinalOutput(clusteredOutput)
            
            // Save to cache and session
            if (currentInputHash) {
              savePerspectivesToCache(
                currentInputHash,
                outputData.perspectives,
                clusteredOutput
              )
              saveModule3Data({
                perspectives: outputData.perspectives,
                finalOutput: clusteredOutput,
                inputHash: currentInputHash
              })
              setIsFromCache(true)
            }
            
            // Auto-advance to output step
            setTimeout(() => {
              setCurrentStep(3)
              setShowOutputGraph(true)
            }, 2000)
          }
        }
      }
    } catch (error) {
      console.error('[Module3] Error loading completed results:', error)
    }
  }

  const startStatusPolling = () => {
    // Clear any existing polling
    if (statusPollingRef.current) {
      clearInterval(statusPollingRef.current)
    }
    
    // Poll every 2 seconds
    statusPollingRef.current = setInterval(async () => {
      try {
        const response = await fetch("/module3/api/status")
        if (response.ok) {
          const status = await response.json()
          
          if (status.status === 'completed' && status.pipeline_complete) {
            console.log('[Module3] Pipeline completed via polling')
            if (statusPollingRef.current) {
              clearInterval(statusPollingRef.current)
              statusPollingRef.current = null
            }
            setIsGenerating(false)
            setLoading(false)
            await loadCompletedResults()
          }
        }
      } catch (error) {
        console.error('[Module3] Polling error:', error)
      }
    }, 2000)
  }

  const checkBackendStatus = async () => {
    try {
      const response = await fetch("/module3/api/status", { 
        method: 'GET',
        signal: AbortSignal.timeout(2000)
      })
      if (response.ok) {
        setBackendRunning(true)
        fetchInputData()
      }
    } catch (error) {
      setBackendRunning(false)
    }
  }

  const startModule3 = async () => {
    setStartingBackend(true)

    try {
      const response = await fetch('/module3/api/health')
      
      if (response.ok) {
        setBackendRunning(true)
        setStartingBackend(false)
        setCurrentStep(1)
        setIsGenerating(true)
        setLoading(true)
        setPerspectives([])
        setFinalOutput(null)
        setShowGraph(false)
        setShowOutputGraph(false)
        setAutoAdvanceTriggered(false)

        await startPerspectiveGeneration()
      } else {
        console.error('[Module3] Backend not responding')
        setStartingBackend(false)
      }

    } catch (error) {
      console.error('[Module3] Error starting module3:', error)
      setStartingBackend(false)
    }
  }



  const fetchInputData = async () => {
    try {
      const response = await fetch("/module3/api/input")
      if (response.ok) {
        const data = await response.json()
        setInputData(data)
        
        // Update hash when input changes
        const hash = generateInputHash({
          topic: data.topic,
          text: data.text
        })
        setCurrentInputHash(hash)
        
        setBackendRunning(true)
      }
    } catch (error) {
      console.error("Error fetching input data:", error)
      setBackendRunning(false)
    }
  }



  const startPerspectiveGeneration = async () => {
    setIsGenerating(true)
    setLoading(true)
    setPerspectives([])
    setAutoAdvanceTriggered(false)
    setIsRestoringFromSession(false) // Mark as fresh generation

    try {
      // Setup event listeners BEFORE starting pipeline
      setupEventListeners()
      
      // Start status polling
      startStatusPolling()
      
      // Start the pipeline
      const response = await fetch("/module3/api/run_pipeline_stream", {
        method: "POST",
      })

      if (!response.ok) {
        throw new Error('Failed to start pipeline')
      }
      
    } catch (error) {
      console.error("Error starting pipeline:", error)
      setLoading(false)
      setIsGenerating(false)
      if (statusPollingRef.current) {
        clearInterval(statusPollingRef.current)
        statusPollingRef.current = null
      }
    }
  }

  const setupEventListeners = () => {
        
    // Listen for batch updates via Server-Sent Events
    const batchEventSource = new EventSource('/api/perspective-update')
    
    batchEventSource.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data)
        
        if (data.type === 'batch') {
                    
          // Fetch the actual perspectives from backend (ONLY when notified)
          const response = await fetch("/module3/api/output")
          if (response.ok) {
            const outputData = await response.json()
            
            if (outputData.perspectives && Array.isArray(outputData.perspectives)) {
                            setPerspectives([...outputData.perspectives])
            }
          }
        }
      } catch (error) {
        console.error('[SSE] Error processing batch event:', error)
      }
    }
    
    batchEventSource.onerror = (error) => {
      console.error('[SSE] Batch EventSource error:', error)
    }
    
    // Listen for completion via Server-Sent Events
    const completeEventSource = new EventSource('/api/perspective-complete')
    
    completeEventSource.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data)
        
        if (data.type === 'complete') {
          console.log('[SSE] Pipeline complete signal received')
                    
          // Close event sources
          batchEventSource.close()
          completeEventSource.close()
          
          // Stop status polling
          if (statusPollingRef.current) {
            clearInterval(statusPollingRef.current)
            statusPollingRef.current = null
          }
          
          setIsGenerating(false)
          setLoading(false)
          
          // Fetch the complete output.json one final time
          const finalResponse = await fetch("/module3/api/output")
          if (finalResponse.ok) {
            const finalData = await finalResponse.json()
            
            if (finalData.perspectives && Array.isArray(finalData.perspectives)) {
              const allPerspectives = finalData.perspectives
              setPerspectives(allPerspectives)
              
              // Fetch clustered output from backend final_output files
              try {
                const [leftistRes, commonRes, rightistRes] = await Promise.all([
                  fetch("/module3/module3/output/leftist"),
                  fetch("/module3/module3/output/common"),
                  fetch("/module3/module3/output/rightist")
                ])
                
                if (leftistRes.ok && commonRes.ok && rightistRes.ok) {
                  const leftist = await leftistRes.json()
                  const common = await commonRes.json()
                  const rightist = await rightistRes.json()
                  
                  const clusteredOutput = { leftist, common, rightist }
                  setFinalOutput(clusteredOutput)
                  
                  // Save to cache and session
                  if (currentInputHash) {
                    savePerspectivesToCache(
                      currentInputHash,
                      allPerspectives,
                      clusteredOutput
                    )
                    saveModule3Data({
                      perspectives: allPerspectives,
                      finalOutput: clusteredOutput,
                      inputHash: currentInputHash
                    })
                    setIsFromCache(true)
                  }
                }
              } catch (error) {
                console.error('[Module3] Error fetching final output from backend:', error)
              }
              
              // Move to Step 2 (Visualisation) and show graph
              setCurrentStep(2)
              setShowGraph(true)
            }
          }
        }
      } catch (error) {
        console.error('[SSE] Error processing complete event:', error)
      }
    }
    
    completeEventSource.onerror = (error) => {
      console.error('[SSE] Complete EventSource error:', error)
    }
    
    // Timeout after 5 minutes
    setTimeout(() => {
      batchEventSource.close()
      completeEventSource.close()
      setLoading(false)
      setIsGenerating(false)
          }, 300000)
  }

  // Helper to get color for perspective
  const getColorClass = (color: string) => {
    switch(color.toLowerCase()) {
      case 'red': return 'bg-red-500'
      case 'orange': return 'bg-orange-500'
      case 'yellow': return 'bg-yellow-500'
      case 'green': return 'bg-green-500'
      case 'blue': return 'bg-blue-500'
      case 'indigo': return 'bg-indigo-500'
      case 'violet': return 'bg-purple-500'
      default: return 'bg-gray-500'
    }
  }

  const getColorName = (color: string) => {
    // Return the color as-is, capitalize first letter
    return color.charAt(0).toUpperCase() + color.slice(1).toLowerCase()
  }

  return (
    <ModuleLayout
      moduleNumber={3}
      title="Perspective Generation"
      description="AI generates multiple perspectives from various viewpoints, then two agents debate them to analyze the overall standing of information"
      status="ready"
    >
      <div className="space-y-12">
        {/* Status Overview */}
        <div className="border border-white/10 rounded p-6 space-y-4">
          {/* Backend & Processing Status */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              {/* Backend Status */}
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${backendRunning ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                <div>
                  <span className="text-sm text-white/70">Backend</span>
                  <p className="text-xs text-white/40">{backendRunning ? 'Running' : 'Offline'}</p>
                </div>
              </div>

              {/* Processing Status */}
              {isGenerating && (
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                  <div>
                    <span className="text-sm text-white/70">Generating</span>
                    <p className="text-xs text-white/40">{perspectives.length} perspectives</p>
                  </div>
                </div>
              )}

              {/* Cache Status */}
              {isFromCache && (
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                  <div>
                    <span className="text-sm text-white/70">Cached</span>
                    <p className="text-xs text-white/40">Instant load</p>
                  </div>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3">
              {!backendRunning && (
                <button
                  onClick={checkBackendStatus}
                  className="px-4 py-2 border border-white/20 rounded text-sm text-white/80 hover:bg-white/5 transition-all"
                >
                  Refresh Status
                </button>
              )}
              {isFromCache && (
                <>
                  <button
                    onClick={() => {
                      setCurrentModule(4)
                      window.location.href = "/modules/4"
                    }}
                    className="px-4 py-2 border border-blue-500/30 rounded text-sm text-blue-400 hover:bg-blue-500/10 transition-all"
                  >
                    Continue to Module 4 →
                  </button>
                  <button
                    onClick={() => {
                      if (confirm('Clear cache and force regenerate?')) {
                        clearCacheForHash(currentInputHash)
                        setPerspectives([])
                        setFinalOutput(null)
                        setIsFromCache(false)
                        setCurrentStep(0)
                        setShowGraph(false)
                        setShowOutputGraph(false)
                        setAutoAdvanceTriggered(false)
                        setIsRestoringFromSession(false)
                        if (backendRunning) {
                          checkBackendStatusAndResume()
                        }
                      }
                    }}
                    className="px-4 py-2 border border-yellow-500/30 rounded text-sm text-yellow-400 hover:bg-yellow-500/10 transition-all"
                  >
                    Force Regenerate
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Help Text */}
          {!backendRunning && (
            <div className="pt-4 border-t border-white/10">
              <p className="text-xs text-white/40">
                Backend not running. Module 3 is triggered automatically by Module 2. If you need to start it manually, run <code className="text-white/60 bg-white/5 px-1 py-0.5 rounded">start-module3.bat</code>
              </p>
            </div>
          )}
        </div>

        {/* Progress Indicator - Enhanced with Clickable Steps */}
        <div className="border border-white/10 rounded p-6 bg-black/20">
          <div className="relative">
            {/* Step Headers */}
            <div className="flex items-center justify-between mb-8 relative">
              {steps.map((step, index) => (
                <button
                  key={index}
                  onClick={() => setCurrentStep(index)}
                  disabled={isGenerating && index !== currentStep}
                  className={`flex-1 flex flex-col items-center gap-3 transition-all duration-300 relative group ${
                    isGenerating && index !== currentStep ? 'cursor-not-allowed' : 'cursor-pointer'
                  }`}
                >
                  {/* Step Number Circle */}
                  <div className="relative">
                    <div className={`rounded-full border-2 flex items-center justify-center font-light transition-all duration-300 ${
                      index === currentStep
                        ? 'w-14 h-14 text-lg border-white bg-white text-black shadow-lg shadow-white/30'
                        : 'w-10 h-10 text-sm border-white/50 bg-white/10 text-white/70 hover:border-white hover:bg-white/20'
                    }`}>
                      {index + 1}
                    </div>
                    
                    {/* Animated Highlight Circle */}
                    {index === currentStep && (
                      <div className="absolute inset-0 rounded-full border-2 border-white animate-ping opacity-20" />
                    )}
                  </div>
                  
                  {/* Step Name */}
                  <div className={`text-center transition-all duration-300 ${
                    index === currentStep
                      ? 'text-white text-sm font-normal'
                      : 'text-white/60 text-xs hover:text-white/80'
                  }`}>
                    <div className="font-light">{step.name}</div>
                    {index === currentStep && (
                      <div className="text-[10px] text-white/50 mt-1 animate-fadeIn">
                        {step.description}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
            
            {/* Smooth Moving Indicator Bar */}
            <div className="relative h-1 bg-white/5 rounded-full overflow-hidden">
              <div 
                className="absolute top-0 left-0 h-full bg-gradient-to-r from-white/50 via-white to-white/50 rounded-full transition-all duration-500 ease-out"
                style={{ 
                  width: `${100 / steps.length}%`,
                  transform: `translateX(${currentStep * 100}%)`
                }}
              />
            </div>
          </div>
        </div>

        {/* Step Content */}
        <div className="border border-white/10 rounded p-8 min-h-[400px]">
          {currentStep === 0 && (
            <div className="space-y-6 animate-fadeIn">
              <h3 className="text-base font-light text-white/70 mb-6">Input Data</h3>
              {inputData ? (
                <div className="space-y-6">
                  <div>
                    <div className="text-xs text-white/40 mb-2">Topic</div>
                    <div className="text-white text-lg font-light">{inputData.topic}</div>
                  </div>
                  <div>
                    <div className="text-xs text-white/40 mb-2">Significance Score</div>
                    <div className="flex items-center gap-3">
                      <div className="text-white text-2xl font-light">{inputData.significance_score}</div>
                      <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-white transition-all duration-1000 ease-out"
                          style={{ width: `${inputData.significance_score * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  {inputData.text && (
                    <div>
                      <div className="text-xs text-white/40 mb-3">Content Preview</div>
                      <div className="p-5 bg-black/20 rounded border border-white/10 max-h-48 overflow-y-auto">
                        <p className="text-sm text-white/60 leading-relaxed">{inputData.text.substring(0, 300)}...</p>
                      </div>
                    </div>
                  )}
                  {backendRunning && (
                    <div className="pt-4">
                      <div className="flex items-center gap-2 text-xs text-green-400">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                        <span>Ready to generate perspectives</span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center h-64">
                  <div className="text-white/40 text-sm">Loading input data...</div>
                </div>
              )}
            </div>
          )}

          {currentStep === 1 && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-light text-white/70">Generating Perspectives</h3>
                <div className="flex items-center gap-3">
                  <div className="text-xs text-white/40">
                    {perspectives.length} perspectives
                  </div>
                  {isGenerating && (
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                      <TextShimmer
                        duration={1.5}
                        className="text-xs font-light [--base-color:theme(colors.green.400)] [--base-gradient-color:theme(colors.green.200)] dark:[--base-color:theme(colors.green.500)] dark:[--base-gradient-color:theme(colors.green.300)]"
                      >
                        Generating perspectives...
                      </TextShimmer>
                    </div>
                  )}
                </div>
              </div>

              {/* Horizontal Glassy Carousel */}
              {isGenerating && perspectives.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 gap-4">
                  <div className="flex gap-2">
                    <div className="w-2 h-2 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <TextShimmer
                    duration={2}
                    className="text-sm font-light [--base-color:theme(colors.white/40)] [--base-gradient-color:theme(colors.white/80)]"
                  >
                    Initializing perspective generation engine...
                  </TextShimmer>
                </div>
              ) : (
                <PerspectiveCarousel
                  perspectives={perspectives}
                  getColorClass={getColorClass}
                  getColorName={getColorName}
                />
              )}
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-base font-light text-white/70">Visualisation ({perspectives.length} perspectives)</h3>
                <button
                  onClick={() => setShowMethodology(true)}
                  className="px-4 py-2 text-xs text-white/60 hover:text-white/90 border border-white/10 hover:border-white/30 rounded transition-all"
                >
                  See how we generate perspectives →
                </button>
              </div>

              {/* Animated Graph */}
              {showGraph && perspectives.length > 0 && (
                <div className="p-6 border border-white/15 rounded">
                  <div className="text-xs text-white/80 font-medium mb-4">Bias × Significance Distribution</div>
                  <div ref={graphRef} className="relative w-full h-96 bg-black/20 rounded border border-white/10">
                    {/* Y-axis */}
                    <div className="absolute left-0 top-0 bottom-0 w-12 flex flex-col justify-between py-4 text-xs text-white/80 font-semibold">
                      <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '0.5s', animationFillMode: 'forwards' }}>1.0</span>
                      <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '0.6s', animationFillMode: 'forwards' }}>0.8</span>
                      <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '0.7s', animationFillMode: 'forwards' }}>0.6</span>
                      <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '0.8s', animationFillMode: 'forwards' }}>0.4</span>
                      <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '0.9s', animationFillMode: 'forwards' }}>0.2</span>
                      <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '1.0s', animationFillMode: 'forwards' }}>0.0</span>
                    </div>
                    
                    {/* X-axis */}
                    <div className="absolute bottom-0 left-12 right-0 h-8 flex justify-between px-4 text-xs text-white/80 font-semibold items-center">
                      <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '0.5s', animationFillMode: 'forwards' }}>0.0</span>
                      <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '0.6s', animationFillMode: 'forwards' }}>0.25</span>
                      <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '0.7s', animationFillMode: 'forwards' }}>0.5</span>
                      <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '0.8s', animationFillMode: 'forwards' }}>0.75</span>
                      <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '0.9s', animationFillMode: 'forwards' }}>1.0</span>
                    </div>
                    
                    {/* Axis Labels */}
                    <div className="absolute left-12 top-4 right-4 bottom-8 overflow-hidden">
                      {/* X-axis label (bottom) */}
                      <div 
                        className="absolute left-1/2 -translate-x-1/2 -bottom-6 text-xs text-white/80 font-semibold opacity-0 animate-fadeIn whitespace-nowrap"
                        style={{ animationDelay: '0.3s', animationFillMode: 'forwards' }}
                      >
                        Political Bias (Leftist → Rightist)
                      </div>
                    </div>

                    {/* Grid */}
                    <div className="absolute left-12 top-4 right-4 bottom-8">
                      {/* Vertical grid lines */}
                      <div className="absolute left-0 top-0 bottom-0 w-px bg-white/30 origin-top animate-drawVertical" style={{ animationDelay: '0s', animationFillMode: 'forwards' }} />
                      <div className="absolute left-1/4 top-0 bottom-0 w-px bg-white/15 origin-top animate-drawVertical" style={{ animationDelay: '0.05s', animationFillMode: 'forwards' }} />
                      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/30 origin-top animate-drawVertical" style={{ animationDelay: '0.1s', animationFillMode: 'forwards' }} />
                      <div className="absolute left-3/4 top-0 bottom-0 w-px bg-white/15 origin-top animate-drawVertical" style={{ animationDelay: '0.15s', animationFillMode: 'forwards' }} />
                      <div className="absolute right-0 top-0 bottom-0 w-px bg-white/30 origin-top animate-drawVertical" style={{ animationDelay: '0.2s', animationFillMode: 'forwards' }} />
                      
                      {/* Horizontal grid lines */}
                      <div className="absolute top-0 left-0 right-0 h-px bg-white/30 origin-left animate-drawHorizontal" style={{ animationDelay: '0.25s', animationFillMode: 'forwards' }} />
                      <div className="absolute top-1/2 left-0 right-0 h-px bg-white/30 origin-left animate-drawHorizontal" style={{ animationDelay: '0.3s', animationFillMode: 'forwards' }} />
                      <div className="absolute bottom-0 left-0 right-0 h-px bg-white/30 origin-left animate-drawHorizontal" style={{ animationDelay: '0.35s', animationFillMode: 'forwards' }} />
                      
                      {/* Data points */}
                      <div className="relative w-full h-full">
                        {perspectives.map((p, index) => {
                          // Backend provides bias_x already in 0-1 range
                          const x = p.bias_x * 100 // Convert 0 to 1 → 0 to 100%
                          const y = (1 - p.significance_y) * 100 // Invert Y axis
                          
                          return (
                            <div
                              key={index}
                              className={`absolute w-4 h-4 rounded-full ${getColorClass(p.color)} opacity-0 animate-fadeIn cursor-pointer hover:scale-150 transition-all shadow-lg z-10`}
                              style={{
                                left: `${x}%`,
                                top: `${y}%`,
                                transform: 'translate(-50%, -50%)',
                                animationDelay: `${1.2 + index * 0.03}s`,
                                animationFillMode: 'forwards',
                                filter: 'brightness(1.5) saturate(1.2)',
                                boxShadow: '0 0 8px rgba(255,255,255,0.3)'
                              }}
                              onMouseEnter={(e) => {
                                setHoveredPerspective(p)
                                const rect = e.currentTarget.getBoundingClientRect()
                                setTooltipPosition({ x: rect.left + rect.width / 2, y: rect.top })
                              }}
                              onMouseLeave={() => {
                                setHoveredPerspective(null)
                              }}
                            />
                          )
                        })}
                      </div>
                    </div>
                    
                    {/* Labels */}
                    <div className="absolute top-2 left-1/2 transform -translate-x-1/2 text-xs text-white/80 font-semibold">
                      Bias →
                    </div>
                    <div className="absolute -left-2 top-1/2 transform -translate-y-1/2 -rotate-90 text-xs text-white/80 font-semibold origin-center">
                      ← Significance
                    </div>
                  </div>
                </div>
              )}

              {/* Custom Tooltip */}
              {hoveredPerspective && (
                <div
                  className="fixed z-[9999] pointer-events-none"
                  style={{
                    left: tooltipPosition.x,
                    top: tooltipPosition.y,
                    transform: 'translate(-50%, -105%)'
                  }}
                >
                  <div className="bg-black/95 backdrop-blur-xl border border-white/20 rounded-lg p-4 shadow-2xl max-w-sm animate-fadeIn">
                    {/* Header */}
                    <div className="flex items-center gap-3 mb-3 pb-2 border-b border-white/10">
                      <div className={`w-3 h-3 rounded-full ${getColorClass(hoveredPerspective.color)}`} />
                      <span className="text-sm text-white/90 font-light uppercase tracking-wider">
                        {getColorName(hoveredPerspective.color)}
                      </span>
                    </div>

                    {/* Metadata */}
                    <div className="flex gap-4 mb-3 text-xs">
                      <div className="flex flex-col">
                        <span className="text-white/40">Bias</span>
                        <span className="text-white/80 font-mono">{hoveredPerspective.bias_x.toFixed(3)}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-white/40">Significance</span>
                        <span className="text-white/80 font-mono">{hoveredPerspective.significance_y.toFixed(3)}</span>
                      </div>
                    </div>

                    {/* Perspective Text */}
                    <p className="text-sm text-white/70 leading-relaxed">
                      {hoveredPerspective.text}
                    </p>
                  </div>
                </div>
              )}

              {!showGraph && (
                <div className="flex items-center justify-center h-64">
                  <div className="text-white/40 text-sm">Generating visualisation...</div>
                </div>
              )}
            </div>
          )}

          {currentStep === 3 && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-base font-light text-white/70">Output</h3>
                <button
                  onClick={() => setShowClusteringDetails(true)}
                  className="px-4 py-2 text-xs text-white/60 hover:text-white/90 border border-white/10 hover:border-white/30 rounded transition-all"
                >
                  See what this means →
                </button>
              </div>
              {finalOutput ? (
                <div className="space-y-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="text-xs text-white/40">Three JSON files ready for Module 4</div>
                    {redirectCountdown !== null && (
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 border border-blue-500/30 rounded text-blue-400 text-xs">
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Advancing to Module 4 in {redirectCountdown}s...</span>
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <div className="p-5 border border-red-500/20 bg-red-500/5 rounded">
                      <div className="text-xs text-red-400/70 mb-2 uppercase tracking-wider">Leftist</div>
                      <div className="text-white/80 font-mono text-lg">{finalOutput.leftist?.length || 0} perspectives</div>
                      <div className="text-xs text-white/40 mt-2">Bias: 0.0 - 0.428</div>
                    </div>
                    <div className="p-5 border border-green-500/20 bg-green-500/5 rounded">
                      <div className="text-xs text-green-400/70 mb-2 uppercase tracking-wider">Common</div>
                      <div className="text-white/80 font-mono text-lg">{finalOutput.common?.length || 0} perspectives</div>
                      <div className="text-xs text-white/40 mt-2">Bias: 0.428 - 0.571</div>
                    </div>
                    <div className="p-5 border border-blue-500/20 bg-blue-500/5 rounded">
                      <div className="text-xs text-blue-400/70 mb-2 uppercase tracking-wider">Rightist</div>
                      <div className="text-white/80 font-mono text-lg">{finalOutput.rightist?.length || 0} perspectives</div>
                      <div className="text-xs text-white/40 mt-2">Bias: 0.571 - 1.0</div>
                    </div>
                  </div>

                  {/* Loading Animation */}
                  {loadingOutputGraph && (
                    <div className="flex items-center justify-center h-96 border border-white/10 rounded">
                      <div className="flex flex-col items-center gap-4">
                        <div className="relative w-16 h-16">
                          <div className="absolute inset-0 border-2 border-white/10 rounded-full"></div>
                          <div className="absolute inset-0 border-2 border-t-white/60 rounded-full animate-spin"></div>
                        </div>
                        <p className="text-white/40 text-sm">Generating clustered visualization...</p>
                      </div>
                    </div>
                  )}

                  {/* No data message */}
                  {showOutputGraph && !loadingOutputGraph && (finalOutput.leftist.length === 0 && finalOutput.common.length === 0 && finalOutput.rightist.length === 0) && (
                    <div className="flex items-center justify-center h-64 border border-white/10 rounded">
                      <p className="text-white/40 text-sm">No perspectives available to visualize. Please generate perspectives first.</p>
                    </div>
                  )}

                  {/* Clustered Graph */}
                  {showOutputGraph && !loadingOutputGraph && (finalOutput.leftist.length > 0 || finalOutput.common.length > 0 || finalOutput.rightist.length > 0) && (
                    <div className="p-6 border border-white/15 rounded">
                      <div className="text-xs text-white/80 font-medium mb-4">Clustered Distribution (Leftist • Common • Rightist)</div>
                      <div ref={outputGraphRef} className="relative w-full h-96 bg-black/20 rounded border border-white/10">
                        {/* Y-axis */}
                        <div className="absolute left-0 top-0 bottom-0 w-12 flex flex-col justify-between py-4 text-xs text-white/80 font-semibold">
                          <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '0.5s', animationFillMode: 'forwards' }}>1.0</span>
                          <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '0.6s', animationFillMode: 'forwards' }}>0.8</span>
                          <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '0.7s', animationFillMode: 'forwards' }}>0.6</span>
                          <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '0.8s', animationFillMode: 'forwards' }}>0.4</span>
                          <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '0.9s', animationFillMode: 'forwards' }}>0.2</span>
                          <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '1.0s', animationFillMode: 'forwards' }}>0.0</span>
                        </div>
                        
                        {/* X-axis */}
                        <div className="absolute bottom-0 left-12 right-0 h-8 flex justify-between px-4 text-xs text-white/80 font-semibold items-center">
                          <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '0.5s', animationFillMode: 'forwards' }}>0.0</span>
                          <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '0.6s', animationFillMode: 'forwards' }}>0.25</span>
                          <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '0.7s', animationFillMode: 'forwards' }}>0.5</span>
                          <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '0.8s', animationFillMode: 'forwards' }}>0.75</span>
                          <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '0.9s', animationFillMode: 'forwards' }}>1.0</span>
                        </div>
                        
                        {/* Axis Labels */}
                        <div className="absolute left-12 top-4 right-4 bottom-8 overflow-hidden">
                          {/* X-axis label */}
                          <div 
                            className="absolute left-1/2 -translate-x-1/2 -bottom-6 text-xs text-white/80 font-semibold opacity-0 animate-fadeIn whitespace-nowrap"
                            style={{ animationDelay: '0.3s', animationFillMode: 'forwards' }}
                          >
                            Political Bias (Leftist → Rightist)
                          </div>
                        </div>

                        {/* Clustering Regions (Background) */}
                        <div className="absolute left-12 top-4 right-4 bottom-8">
                          {/* Leftist region (0.0 - 0.428) = 42.8% */}
                          <div 
                            className="absolute top-0 bottom-0 bg-red-500/5 border-r border-red-500/30 opacity-0 animate-fadeIn"
                            style={{ 
                              left: 0, 
                              width: '42.8%',
                              animationDelay: '0.4s',
                              animationFillMode: 'forwards'
                            }}
                          >
                            <div className="absolute top-2 left-2 text-[10px] text-red-400/50 uppercase tracking-wider">Leftist</div>
                          </div>

                          {/* Common region (0.428 - 0.571) = 14.3% */}
                          <div 
                            className="absolute top-0 bottom-0 bg-green-500/5 border-r border-green-500/30 opacity-0 animate-fadeIn"
                            style={{ 
                              left: '42.8%', 
                              width: '14.3%',
                              animationDelay: '0.45s',
                              animationFillMode: 'forwards'
                            }}
                          >
                            <div className="absolute top-2 left-2 text-[10px] text-green-400/50 uppercase tracking-wider">Common</div>
                          </div>

                          {/* Rightist region (0.571 - 1.0) = 42.9% */}
                          <div 
                            className="absolute top-0 bottom-0 bg-blue-500/5 opacity-0 animate-fadeIn"
                            style={{ 
                              left: '57.1%', 
                              width: '42.9%',
                              animationDelay: '0.5s',
                              animationFillMode: 'forwards'
                            }}
                          >
                            <div className="absolute top-2 left-2 text-[10px] text-blue-400/50 uppercase tracking-wider">Rightist</div>
                          </div>
                        </div>

                        {/* Grid */}
                        <div className="absolute left-12 top-4 right-4 bottom-8">
                          {/* Vertical grid lines */}
                          <div className="absolute left-0 top-0 bottom-0 w-px bg-white/30 origin-top animate-drawVertical" style={{ animationDelay: '0s', animationFillMode: 'forwards' }} />
                          <div className="absolute left-1/4 top-0 bottom-0 w-px bg-white/15 origin-top animate-drawVertical" style={{ animationDelay: '0.05s', animationFillMode: 'forwards' }} />
                          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/30 origin-top animate-drawVertical" style={{ animationDelay: '0.1s', animationFillMode: 'forwards' }} />
                          <div className="absolute left-3/4 top-0 bottom-0 w-px bg-white/15 origin-top animate-drawVertical" style={{ animationDelay: '0.15s', animationFillMode: 'forwards' }} />
                          <div className="absolute right-0 top-0 bottom-0 w-px bg-white/30 origin-top animate-drawVertical" style={{ animationDelay: '0.2s', animationFillMode: 'forwards' }} />
                          
                          {/* Horizontal grid lines */}
                          <div className="absolute top-0 left-0 right-0 h-px bg-white/30 origin-left animate-drawHorizontal" style={{ animationDelay: '0.25s', animationFillMode: 'forwards' }} />
                          <div className="absolute top-1/2 left-0 right-0 h-px bg-white/30 origin-left animate-drawHorizontal" style={{ animationDelay: '0.3s', animationFillMode: 'forwards' }} />
                          <div className="absolute bottom-0 left-0 right-0 h-px bg-white/30 origin-left animate-drawHorizontal" style={{ animationDelay: '0.35s', animationFillMode: 'forwards' }} />
                          
                          {/* Data points - from all three clusters */}
                          <div className="relative w-full h-full">
                            {/* Leftist points */}
                            {finalOutput.leftist.map((p, index) => {
                              const x = p.bias_x * 100
                              const y = (1 - p.significance_y) * 100
                              
                              return (
                                <div
                                  key={`leftist-${index}`}
                                  className={`absolute w-4 h-4 rounded-full ${getColorClass(p.color)} opacity-0 animate-fadeIn cursor-pointer hover:scale-150 transition-all shadow-lg z-10 ring-2 ring-red-500/30`}
                                  style={{
                                    left: `${x}%`,
                                    top: `${y}%`,
                                    transform: 'translate(-50%, -50%)',
                                    animationDelay: `${1.2 + index * 0.03}s`,
                                    animationFillMode: 'forwards',
                                    filter: 'brightness(1.5) saturate(1.2)',
                                    boxShadow: '0 0 8px rgba(255,255,255,0.3)'
                                  }}
                                  onMouseEnter={(e) => {
                                    setHoveredPerspective(p)
                                    const rect = e.currentTarget.getBoundingClientRect()
                                    setTooltipPosition({ x: rect.left + rect.width / 2, y: rect.top })
                                  }}
                                  onMouseLeave={() => {
                                    setHoveredPerspective(null)
                                  }}
                                />
                              )
                            })}

                            {/* Common points */}
                            {finalOutput.common.map((p, index) => {
                              const x = p.bias_x * 100
                              const y = (1 - p.significance_y) * 100
                              
                              return (
                                <div
                                  key={`common-${index}`}
                                  className={`absolute w-4 h-4 rounded-full ${getColorClass(p.color)} opacity-0 animate-fadeIn cursor-pointer hover:scale-150 transition-all shadow-lg z-10 ring-2 ring-green-500/30`}
                                  style={{
                                    left: `${x}%`,
                                    top: `${y}%`,
                                    transform: 'translate(-50%, -50%)',
                                    animationDelay: `${1.2 + (finalOutput.leftist.length + index) * 0.03}s`,
                                    animationFillMode: 'forwards',
                                    filter: 'brightness(1.5) saturate(1.2)',
                                    boxShadow: '0 0 8px rgba(255,255,255,0.3)'
                                  }}
                                  onMouseEnter={(e) => {
                                    setHoveredPerspective(p)
                                    const rect = e.currentTarget.getBoundingClientRect()
                                    setTooltipPosition({ x: rect.left + rect.width / 2, y: rect.top })
                                  }}
                                  onMouseLeave={() => {
                                    setHoveredPerspective(null)
                                  }}
                                />
                              )
                            })}

                            {/* Rightist points */}
                            {finalOutput.rightist.map((p, index) => {
                              const x = p.bias_x * 100
                              const y = (1 - p.significance_y) * 100
                              
                              return (
                                <div
                                  key={`rightist-${index}`}
                                  className={`absolute w-4 h-4 rounded-full ${getColorClass(p.color)} opacity-0 animate-fadeIn cursor-pointer hover:scale-150 transition-all shadow-lg z-10 ring-2 ring-blue-500/30`}
                                  style={{
                                    left: `${x}%`,
                                    top: `${y}%`,
                                    transform: 'translate(-50%, -50%)',
                                    animationDelay: `${1.2 + (finalOutput.leftist.length + finalOutput.common.length + index) * 0.03}s`,
                                    animationFillMode: 'forwards',
                                    filter: 'brightness(1.5) saturate(1.2)',
                                    boxShadow: '0 0 8px rgba(255,255,255,0.3)'
                                  }}
                                  onMouseEnter={(e) => {
                                    setHoveredPerspective(p)
                                    const rect = e.currentTarget.getBoundingClientRect()
                                    setTooltipPosition({ x: rect.left + rect.width / 2, y: rect.top })
                                  }}
                                  onMouseLeave={() => {
                                    setHoveredPerspective(null)
                                  }}
                                />
                              )
                            })}
                          </div>
                        </div>
                        
                        {/* Labels */}
                        <div className="absolute top-2 left-1/2 transform -translate-x-1/2 text-xs text-white/40">
                          Bias →
                        </div>
                        <div className="absolute -left-2 top-1/2 transform -translate-y-1/2 -rotate-90 text-xs text-white/40 origin-center">
                          ← Significance
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-white/40 text-sm">Final output files will appear here after pipeline completion</p>
              )}
            </div>
          )}
        </div>
      </div>

      {showClusteringDetails && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/80 backdrop-blur-xl"
            onClick={() => setShowClusteringDetails(false)}
          />
          <div
            className="relative w-full max-w-[760px] max-h-[90vh] overflow-y-auto bg-black/90 backdrop-blur-2xl border border-white/20 rounded-2xl shadow-2xl p-8"
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(255,255,255,0.2) transparent',
            }}
          >
            <button
              onClick={() => setShowClusteringDetails(false)}
              className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full transition-colors"
            >
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <h2 className="text-2xl font-light text-white mb-6">How We Cluster These Perspectives</h2>

            <div className="space-y-6 text-white/70 leading-relaxed">
              <section>
                <p className="text-sm">
                  The three JSON files shown here are produced by the backend module <code className="text-xs">module3/backend/modules/TOP-N_K_MEANS-CLUSTERING.py</code>. After Module 3 generates all raw perspectives, this script trims and distributes them so that Module 4 only receives the most representative voices.
                </p>
              </section>

              <section className="pt-4 border-t border-white/10">
                <h3 className="text-lg font-light text-white/90 mb-3">1. Categorise Every Perspective</h3>
                <p className="text-sm">
                  Each perspective already carries a <code className="text-xs">bias_x</code> value. The script splits them into three pools using the same thresholds you see on the graph:
                </p>
                <ul className="list-disc list-inside text-sm space-y-2 ml-4">
                  <li><strong className="text-white/80">Leftist:</strong> bias_x &lt; 0.428</li>
                  <li><strong className="text-white/80">Common:</strong> 0.428 ≤ bias_x ≤ 0.571</li>
                  <li><strong className="text-white/80">Rightist:</strong> bias_x &gt; 0.571</li>
                </ul>
              </section>

              <section className="pt-4 border-t border-white/10">
                <h3 className="text-lg font-light text-white/90 mb-3">2. Decide How Many We Keep</h3>
                <p className="text-sm mb-3">
                  The script adapts the target size based on how many raw perspectives exist. For example:
                </p>
                <ul className="list-disc list-inside text-sm space-y-2 ml-4">
                  <li>7-14 inputs → keep 6</li>
                  <li>15-28 inputs → keep 14</li>
                  <li>29-77 inputs → keep 21</li>
                  <li>78-136 inputs → keep 28</li>
                </ul>
                <p className="text-sm">
                  If there are fewer perspectives than the target, it keeps everything. Otherwise, it works toward that cap.
                </p>
              </section>

              <section className="pt-4 border-t border-white/10">
                <h3 className="text-lg font-light text-white/90 mb-3">3. Allocate Slots Fairly</h3>
                <p className="text-sm">
                  It calculates how much of the total each bias pool represents and gives them proportional slots. A rounding pass ensures the slots add up to the exact target count, borrowing from the largest pool when necessary.
                </p>
              </section>

              <section className="pt-4 border-t border-white/10">
                <h3 className="text-lg font-light text-white/90 mb-3">4. Keep the Strongest Voices</h3>
                <p className="text-sm">
                  Inside each pool, perspectives are sorted by <code className="text-xs">significance_y</code> (highest first). Only the top entries that fit the allocated slots survive. This guarantees every bias group contributes its most meaningful arguments.
                </p>
              </section>

              <section className="pt-4 border-t border-white/10">
                <h3 className="text-lg font-light text-white/90 mb-3">5. Write the Final Files</h3>
                <p className="text-sm">
                  The selected perspectives are saved into <code className="text-xs">final_output/leftist.json</code>, <code className="text-xs">final_output/common.json</code>, and <code className="text-xs">final_output/rightist.json</code>. These are exactly the files displayed in Step 4 and consumed by downstream modules.
                </p>
              </section>

              <section className="pt-4 border-t border-white/10">
                <p className="text-sm">
                  In short, the clustering pass makes sure you do not just get fewer points; you get the most balanced and high-impact mix of viewpoints available from the raw generation stage.
                </p>
              </section>
            </div>
          </div>
        </div>
      )}

      {/* Methodology Popup */}
      {showMethodology && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div 
            className="absolute inset-0 bg-black/80 backdrop-blur-xl"
            onClick={() => setShowMethodology(false)}
          />
          <div 
            className="relative w-full max-w-[800px] max-h-[90vh] overflow-y-auto bg-black/90 backdrop-blur-2xl border border-white/20 rounded-2xl shadow-2xl p-8"
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(255,255,255,0.2) transparent',
            }}
          >
            <button
              onClick={() => setShowMethodology(false)}
              className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full transition-colors"
            >
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <h2 className="text-2xl font-light text-white mb-6">Perspective Generation Methodology</h2>

            <div className="space-y-6 text-white/70 leading-relaxed">
              <section>
                <h3 className="text-lg font-light text-white/90 mb-3">The Psychology Behind It</h3>
                <p className="text-sm mb-3">
                  Human perception of information is inherently subjective and influenced by cognitive biases, personal experiences, and ideological frameworks. Rather than attempting to determine "absolute truth," our system acknowledges this fundamental reality and explores the spectrum of interpretations.
                </p>
                <p className="text-sm">
                  By generating multiple perspectives across the ideological spectrum, we create a comprehensive map of how different viewpoints might interpret the same information. This approach is grounded in several psychological principles:
                </p>
                <ul className="list-disc list-inside text-sm mt-3 space-y-2 ml-4">
                  <li><strong className="text-white/80">Confirmation Bias:</strong> People tend to favor information that confirms existing beliefs</li>
                  <li><strong className="text-white/80">Motivated Reasoning:</strong> Emotional stakes influence how we process information</li>
                  <li><strong className="text-white/80">Cognitive Framing:</strong> The same facts can be interpreted differently based on context</li>
                  <li><strong className="text-white/80">Empathy Mapping:</strong> Understanding diverse viewpoints reduces polarization</li>
                </ul>
              </section>

              <section className="pt-4 border-t border-white/10">
                <h3 className="text-lg font-light text-white/90 mb-3">The Mathematical Model</h3>
                
                {/* Perspective Count Formula */}
                <div className="bg-white/5 p-4 rounded-lg mb-4">
                  <p className="text-sm font-mono text-white/90 mb-2">How Many Perspectives to Generate:</p>
                  <code className="text-xs text-white/70 block mb-3">
                    N = ⌈128 × (s^2.8) + 8⌉
                  </code>
                  <p className="text-xs text-white/60 leading-relaxed">
                    Where <strong className="text-white/80">s</strong> is the significance score (0-1) from Module 2. 
                    This non-linear formula ensures that highly significant topics get exponentially more perspectives (up to ~136), 
                    while less significant ones get fewer (minimum 8). The power of 2.8 creates rapid scaling for important information.
                  </p>
                </div>

                {/* Bias Assignment Formula */}
                <div className="bg-white/5 p-4 rounded-lg mb-3">
                  <p className="text-sm font-mono text-white/90 mb-2">Bias Position Assignment:</p>
                  <code className="text-xs text-white/70 block">
                    bias_x = (color_index / 6)<br/>
                    color_index ∈ [0, 6] → bias_x ∈ [0, 1]
                  </code>
                </div>

                <p className="text-sm mb-3">
                  Each perspective is assigned a <strong className="text-white/80">bias coordinate (x)</strong> and a <strong className="text-white/80">significance score (y)</strong>:
                </p>
                <ul className="list-disc list-inside text-sm space-y-2 ml-4">
                  <li><strong className="text-white/80">Bias (X-axis):</strong> Represents ideological positioning from leftist (0.0) to rightist (1.0)</li>
                  <li><strong className="text-white/80">Significance (Y-axis):</strong> Measures the importance and impact of the perspective (0.0-1.0)</li>
                  <li><strong className="text-white/80">Color Mapping:</strong> Red → Orange → Yellow → Green → Blue → Indigo → Violet (spectrum visualization)</li>
                </ul>
              </section>

              <section className="pt-4 border-t border-white/10">
                <h3 className="text-lg font-light text-white/90 mb-3">The AI Generation Process</h3>
                <ol className="list-decimal list-inside text-sm space-y-2 ml-4">
                  <li>Input analysis extracts key themes and entities</li>
                  <li>For each color in the spectrum, we prompt the AI to generate perspectives aligned with that ideological position</li>
                  <li>Each perspective includes contextual reasoning and emotional framing appropriate to that viewpoint</li>
                  <li>Significance scores are calculated based on relevance, impact, and coherence</li>
                  <li>Results are clustered into three groups: leftist (0.0-0.35), common (0.35-0.65), rightist (0.65-1.0)</li>
                </ol>
              </section>

              <section className="pt-4 border-t border-white/10">
                <h3 className="text-lg font-light text-white/90 mb-3">Why This Matters</h3>
                <p className="text-sm">
                  By visualizing information through multiple lenses, we enable users to understand not just <em>what</em> information says, but <em>how</em> it might be interpreted by different audiences. This reduces manipulation, increases critical thinking, and promotes informed decision-making in an era of information warfare.
                </p>
              </section>
            </div>
          </div>
        </div>
      )}
    </ModuleLayout>
  )
}



