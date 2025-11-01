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
    // Cleanup expired caches on mount
    cleanupExpiredCaches()
    
    // Load input data
    const cachedInput = localStorage.getItem('module3_input')
    const input = cachedInput ? JSON.parse(cachedInput) : fallbackInput
    setInputData(input)
    
    if (!cachedInput) {
      localStorage.setItem('module3_input', JSON.stringify(fallbackInput))
    }
    
    // Generate hash for this input
    const hash = generateInputHash({
      topic: input.topic,
      text: input.text
    })
    setCurrentInputHash(hash)
    
    // Try to load from cache
    const cached = loadPerspectivesFromCache(hash)
    if (cached) {
      console.log('[Module3] Loaded from cache:', cached.perspectives.length, 'perspectives')
      console.log('[Module3] Cached finalOutput:', {
        leftist: cached.finalOutput?.leftist?.length || 0,
        common: cached.finalOutput?.common?.length || 0,
        rightist: cached.finalOutput?.rightist?.length || 0
      })
      setPerspectives(cached.perspectives)
      setFinalOutput(cached.finalOutput)
      setIsFromCache(true)
      setCurrentStep(1) // Show perspectives directly
      setShowGraph(true) // Ready to show graph
    } else {
      console.log('[Module3] No cache found, ready for generation')
      setIsFromCache(false)
    }
    
    // Check backend status
    checkBackendStatus()
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
    // If navigating to Step 3 but finalOutput is not set yet, recalculate from perspectives
    if (currentStep === 3 && !finalOutput && perspectives.length > 0) {
      console.log('[Output Graph] Recalculating finalOutput from', perspectives.length, 'perspectives')
      // Backend uses thresholds: leftist (< 0.428), common (0.428 - 0.571), rightist (>= 0.571)
      const LEFTIST_THRESHOLD = 0.428
      const RIGHTIST_THRESHOLD = 0.571
      const leftist = perspectives.filter((p: Perspective) => p.bias_x < LEFTIST_THRESHOLD)
      const rightist = perspectives.filter((p: Perspective) => p.bias_x >= RIGHTIST_THRESHOLD)
      const common = perspectives.filter((p: Perspective) => p.bias_x >= LEFTIST_THRESHOLD && p.bias_x < RIGHTIST_THRESHOLD)
      
      const clusteredOutput = { leftist, rightist, common }
      setFinalOutput(clusteredOutput)
      console.log(`[Output Graph] Recalculated: ${leftist.length} leftist, ${common.length} common, ${rightist.length} rightist`)
    }
    
    if (currentStep === 3 && finalOutput && !showOutputGraph) {
      console.log('[Output Graph] Triggering graph with finalOutput:', {
        leftist: finalOutput.leftist?.length || 0,
        common: finalOutput.common?.length || 0,
        rightist: finalOutput.rightist?.length || 0,
        total: (finalOutput.leftist?.length || 0) + (finalOutput.common?.length || 0) + (finalOutput.rightist?.length || 0)
      })
      
      setLoadingOutputGraph(true)
      setShowOutputGraph(false)
      
      // Show loading for 1.5 seconds, then reveal graph
      setTimeout(() => {
        setLoadingOutputGraph(false)
        setShowOutputGraph(true)
      }, 1500)
    }
    
    // Reset when leaving step 3
    if (currentStep !== 3 && showOutputGraph) {
      setShowOutputGraph(false)
      setLoadingOutputGraph(false)
    }
  }, [currentStep, finalOutput, showOutputGraph, perspectives])

  const checkBackendStatus = async () => {
    try {
      const response = await fetch("http://localhost:8002/api/status", { 
        method: 'GET',
        signal: AbortSignal.timeout(2000)
      })
      if (response.ok) {
        setBackendRunning(true)
        // Fetch fresh input data from backend
        fetchInputData()
      }
    } catch (error) {
      setBackendRunning(false)
    }
  }

  const startBackend = async () => {
    setStartingBackend(true)
    
    try {
      // Start the backend
      const response = await fetch('/api/start-backend', {
        method: 'POST'
      })
      
      const result = await response.json()
      
      if (result.success) {
        console.log(`Backend started successfully with PID: ${result.pid}`)
        
        // Wait for backend to fully initialize
        await new Promise(resolve => setTimeout(resolve, 6000))
        
        // Check backend status
        await checkBackendStatus()
        setStartingBackend(false)
        
        // Move to step 1 and start generation
        setCurrentStep(1)
        setIsGenerating(true)
        setLoading(true)
        setPerspectives([])  // Clear old perspectives
        setFinalOutput(null)  // Clear old clustering data
        setShowGraph(false)   // Reset graph display
        
        // Start the perspective generation pipeline
        await startPerspectiveGeneration()
      } else {
        console.error("Backend start failed:", result.error)
        
        if (result.error?.includes('PORT_IN_USE')) {
          alert(`Port 8002 is already in use!\n\nTo fix this:\n\nOption 1: Kill the existing process\n- Windows: Open Task Manager → Find "python.exe" → End Task\n- Or run: kill-backend.bat\n\nOption 2: Restart your computer\n\nThen try clicking "Start Backend" again.`)
        } else {
          const cleanError = result.error?.replace('INFO:', '').replace('Started server process', '').trim()
          alert(`Failed to start backend: ${cleanError}\n\nPlease make sure:\n1. Python is installed\n2. All dependencies are installed (run: pip install -r requirements.txt)\n3. The backend directory exists at module3/backend`)
        }
        setStartingBackend(false)
      }
    } catch (error: any) {
      console.error("Error starting backend:", error)
      alert(`Error starting backend: ${error.message}`)
      setStartingBackend(false)
    }
  }

  const fetchInputData = async () => {
    try {
      const response = await fetch("http://localhost:8002/api/input")
      if (response.ok) {
        const data = await response.json()
        setInputData(data)
        localStorage.setItem('module3_input', JSON.stringify(data))
        setBackendRunning(true)
      }
    } catch (error) {
      console.error("Error fetching input data:", error)
      setBackendRunning(false)
    }
  }

  const stopBackend = async () => {
    try {
      const response = await fetch('/api/start-backend', {
        method: 'DELETE'
      })
      
      const result = await response.json()
      
      if (result.success) {
        setBackendRunning(false)
        alert('Backend stopped successfully')
      }
    } catch (error: any) {
      console.error("Error stopping backend:", error)
      alert(`Error stopping backend: ${error.message}`)
    }
  }

  const startAutoFlow = () => {
    // Auto-start generation after 5 seconds
    setTimeout(() => {
      setCurrentStep(1)
      startPerspectiveGeneration()
    }, 5000)
  }

  const startPerspectiveGeneration = async () => {
    setIsGenerating(true)
    setLoading(true)
    setPerspectives([])

    try {
      // Setup event listeners BEFORE starting pipeline
      setupEventListeners()
      
      // Start the pipeline
      const response = await fetch("http://localhost:8002/api/run_pipeline_stream", {
        method: "POST",
      })

      if (!response.ok) {
        throw new Error('Failed to start pipeline')
      }
      
      console.log('Pipeline started, waiting for notifications...')
    } catch (error) {
      console.error("Error starting pipeline:", error)
      setLoading(false)
      setIsGenerating(false)
    }
  }

  const setupEventListeners = () => {
    console.log('[SSE] Setting up event listeners...')
    
    // Listen for batch updates via Server-Sent Events
    const batchEventSource = new EventSource('/api/perspective-update')
    
    batchEventSource.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data)
        
        if (data.type === 'batch') {
          console.log(`[SSE] New batch: ${data.color} - ${data.count} total perspectives`)
          
          // Fetch the actual perspectives from backend (ONLY when notified)
          const response = await fetch("http://localhost:8002/api/output")
          if (response.ok) {
            const outputData = await response.json()
            
            if (outputData.perspectives && Array.isArray(outputData.perspectives)) {
              console.log(`Fetched ${outputData.perspectives.length} perspectives from backend`)
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
          console.log(`[SSE] Pipeline complete! ${data.total_perspectives} perspectives`)
          
          // Close event sources
          batchEventSource.close()
          completeEventSource.close()
          
          setIsGenerating(false)
          setLoading(false)
          
          // Fetch the complete output.json one final time
          const finalResponse = await fetch("http://localhost:8002/api/output")
          if (finalResponse.ok) {
            const finalData = await finalResponse.json()
            
            if (finalData.perspectives && Array.isArray(finalData.perspectives)) {
              const allPerspectives = finalData.perspectives
              setPerspectives(allPerspectives)
              
              console.log(`Generated ${allPerspectives.length} perspectives. Moving to graph...`)
              
              // Calculate clustering summary from output.json perspectives (NOT final_output/)
              // Backend uses thresholds: leftist (< 0.428), common (0.428 - 0.571), rightist (>= 0.571)
              const LEFTIST_THRESHOLD = 0.428
              const RIGHTIST_THRESHOLD = 0.571
              const leftist = allPerspectives.filter((p: Perspective) => p.bias_x < LEFTIST_THRESHOLD)
              const rightist = allPerspectives.filter((p: Perspective) => p.bias_x >= RIGHTIST_THRESHOLD)
              const common = allPerspectives.filter((p: Perspective) => p.bias_x >= LEFTIST_THRESHOLD && p.bias_x < RIGHTIST_THRESHOLD)
              
              const clusteredOutput = { leftist, rightist, common }
              setFinalOutput(clusteredOutput)
              console.log(`Clustering: ${leftist.length} leftist, ${common.length} common, ${rightist.length} rightist`)
              
              // Save to cache
              if (currentInputHash) {
                savePerspectivesToCache(
                  currentInputHash,
                  allPerspectives,
                  clusteredOutput
                )
                setIsFromCache(true)
                console.log('[Module3] Saved to cache')
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
      console.log("[SSE] Timeout reached, closing connections")
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
        {/* Backend Control & Cache Status */}
        <div className="border border-white/10 rounded p-6 space-y-4">
          {/* Backend Status */}
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className={`w-2 h-2 rounded-full ${backendRunning ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                <span className="text-sm text-white/70">
                  Backend: {backendRunning ? 'Running' : 'Not Running'}
                </span>
              </div>
              {!backendRunning && (
                <p className="text-xs text-white/40">Start the backend to enable perspective generation</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              {!backendRunning && (
                <button
                  onClick={startBackend}
                  disabled={startingBackend}
                  className="px-4 py-2 border border-white/20 rounded text-sm text-white/80 hover:bg-white/5 transition-all disabled:opacity-50"
                >
                  {startingBackend ? (
                    <span className="flex items-center gap-2">
                      <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Starting...
                    </span>
                  ) : (
                    'Start Backend'
                  )}
                </button>
              )}
              {backendRunning && currentStep === 0 && (
                <button
                  onClick={stopBackend}
                  className="px-4 py-2 border border-red-500/30 rounded text-sm text-red-400 hover:bg-red-500/10 transition-all"
                >
                  Stop Backend
                </button>
              )}
              {currentStep === 0 && (
                <button
                  onClick={checkBackendStatus}
                  className="px-4 py-2 border border-white/20 rounded text-sm text-white/80 hover:bg-white/5 transition-all"
                >
                  Check Status
                </button>
              )}
            </div>
          </div>

          {/* Cache Status */}
          {currentInputHash && (
            <div className="flex items-center justify-between pt-4 border-t border-white/10">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <div className={`w-2 h-2 rounded-full ${isFromCache ? 'bg-blue-500' : 'bg-white/30'}`} />
                  <span className="text-sm text-white/70">
                    Cache: {isFromCache ? 'Using Cached Data' : 'No Cache'}
                  </span>
                </div>
                <p className="text-xs text-white/40">
                  {isFromCache 
                    ? 'Perspectives loaded from cache. Switch pages freely!'
                    : 'Generate perspectives to cache for quick access'
                  }
                </p>
              </div>
              {isFromCache && (
                <button
                  onClick={() => {
                    if (confirm('Clear cache and regenerate perspectives?')) {
                      clearCacheForHash(currentInputHash)
                      setPerspectives([])
                      setFinalOutput(null)
                      setIsFromCache(false)
                      setCurrentStep(0)
                      setShowGraph(false)
                      console.log('[Module3] Cache cleared, ready for regeneration')
                    }
                  }}
                  className="px-4 py-2 border border-yellow-500/30 rounded text-sm text-yellow-400 hover:bg-yellow-500/10 transition-all"
                >
                  Force Regenerate
                </button>
              )}
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
                <div className="p-6 border border-white/10 rounded">
                  <div className="text-xs text-white/40 mb-4">Bias × Significance Distribution</div>
                  <div ref={graphRef} className="relative w-full h-96 bg-black/20 rounded border border-white/10">
                    {/* Y-axis */}
                    <div className="absolute left-0 top-0 bottom-0 w-12 flex flex-col justify-between py-4 text-xs text-white/40">
                      <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '0.5s', animationFillMode: 'forwards' }}>1.0</span>
                      <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '0.6s', animationFillMode: 'forwards' }}>0.8</span>
                      <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '0.7s', animationFillMode: 'forwards' }}>0.6</span>
                      <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '0.8s', animationFillMode: 'forwards' }}>0.4</span>
                      <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '0.9s', animationFillMode: 'forwards' }}>0.2</span>
                      <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '1.0s', animationFillMode: 'forwards' }}>0.0</span>
                    </div>
                    
                    {/* X-axis */}
                    <div className="absolute bottom-0 left-12 right-0 h-8 flex justify-between px-4 text-xs text-white/40 items-center">
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
                        className="absolute left-1/2 -translate-x-1/2 -bottom-6 text-xs text-white/40 opacity-0 animate-fadeIn whitespace-nowrap"
                        style={{ animationDelay: '0.3s', animationFillMode: 'forwards' }}
                      >
                        Political Bias (Leftist → Rightist)
                      </div>
                    </div>

                    {/* Grid */}
                    <div className="absolute left-12 top-4 right-4 bottom-8">
                      {/* Vertical grid lines */}
                      <div className="absolute left-0 top-0 bottom-0 w-px bg-white/10 origin-top animate-drawVertical" style={{ animationDelay: '0s', animationFillMode: 'forwards' }} />
                      <div className="absolute left-1/4 top-0 bottom-0 w-px bg-white/5 origin-top animate-drawVertical" style={{ animationDelay: '0.05s', animationFillMode: 'forwards' }} />
                      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/10 origin-top animate-drawVertical" style={{ animationDelay: '0.1s', animationFillMode: 'forwards' }} />
                      <div className="absolute left-3/4 top-0 bottom-0 w-px bg-white/5 origin-top animate-drawVertical" style={{ animationDelay: '0.15s', animationFillMode: 'forwards' }} />
                      <div className="absolute right-0 top-0 bottom-0 w-px bg-white/10 origin-top animate-drawVertical" style={{ animationDelay: '0.2s', animationFillMode: 'forwards' }} />
                      
                      {/* Horizontal grid lines */}
                      <div className="absolute top-0 left-0 right-0 h-px bg-white/10 origin-left animate-drawHorizontal" style={{ animationDelay: '0.25s', animationFillMode: 'forwards' }} />
                      <div className="absolute top-1/2 left-0 right-0 h-px bg-white/10 origin-left animate-drawHorizontal" style={{ animationDelay: '0.3s', animationFillMode: 'forwards' }} />
                      <div className="absolute bottom-0 left-0 right-0 h-px bg-white/10 origin-left animate-drawHorizontal" style={{ animationDelay: '0.35s', animationFillMode: 'forwards' }} />
                      
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
                    <div className="absolute top-2 left-1/2 transform -translate-x-1/2 text-xs text-white/40">
                      Bias →
                    </div>
                    <div className="absolute -left-2 top-1/2 transform -translate-y-1/2 -rotate-90 text-xs text-white/40 origin-center">
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
              <h3 className="text-base font-light text-white/70 mb-6">Output</h3>
              {finalOutput ? (
                <div className="space-y-6">
                  <div className="text-xs text-white/40 mb-4">Three JSON files ready for Module 4</div>
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
                    <div className="p-6 border border-white/10 rounded">
                      <div className="text-xs text-white/40 mb-4">Clustered Distribution (Leftist • Common • Rightist)</div>
                      <div ref={outputGraphRef} className="relative w-full h-96 bg-black/20 rounded border border-white/10">
                        {/* Y-axis */}
                        <div className="absolute left-0 top-0 bottom-0 w-12 flex flex-col justify-between py-4 text-xs text-white/40">
                          <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '0.5s', animationFillMode: 'forwards' }}>1.0</span>
                          <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '0.6s', animationFillMode: 'forwards' }}>0.8</span>
                          <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '0.7s', animationFillMode: 'forwards' }}>0.6</span>
                          <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '0.8s', animationFillMode: 'forwards' }}>0.4</span>
                          <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '0.9s', animationFillMode: 'forwards' }}>0.2</span>
                          <span className="opacity-0 animate-fadeIn" style={{ animationDelay: '1.0s', animationFillMode: 'forwards' }}>0.0</span>
                        </div>
                        
                        {/* X-axis */}
                        <div className="absolute bottom-0 left-12 right-0 h-8 flex justify-between px-4 text-xs text-white/40 items-center">
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
                            className="absolute left-1/2 -translate-x-1/2 -bottom-6 text-xs text-white/40 opacity-0 animate-fadeIn whitespace-nowrap"
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
                          <div className="absolute left-0 top-0 bottom-0 w-px bg-white/10 origin-top animate-drawVertical" style={{ animationDelay: '0s', animationFillMode: 'forwards' }} />
                          <div className="absolute left-1/4 top-0 bottom-0 w-px bg-white/5 origin-top animate-drawVertical" style={{ animationDelay: '0.05s', animationFillMode: 'forwards' }} />
                          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/10 origin-top animate-drawVertical" style={{ animationDelay: '0.1s', animationFillMode: 'forwards' }} />
                          <div className="absolute left-3/4 top-0 bottom-0 w-px bg-white/5 origin-top animate-drawVertical" style={{ animationDelay: '0.15s', animationFillMode: 'forwards' }} />
                          <div className="absolute right-0 top-0 bottom-0 w-px bg-white/10 origin-top animate-drawVertical" style={{ animationDelay: '0.2s', animationFillMode: 'forwards' }} />
                          
                          {/* Horizontal grid lines */}
                          <div className="absolute top-0 left-0 right-0 h-px bg-white/10 origin-left animate-drawHorizontal" style={{ animationDelay: '0.25s', animationFillMode: 'forwards' }} />
                          <div className="absolute top-1/2 left-0 right-0 h-px bg-white/10 origin-left animate-drawHorizontal" style={{ animationDelay: '0.3s', animationFillMode: 'forwards' }} />
                          <div className="absolute bottom-0 left-0 right-0 h-px bg-white/10 origin-left animate-drawHorizontal" style={{ animationDelay: '0.35s', animationFillMode: 'forwards' }} />
                          
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



