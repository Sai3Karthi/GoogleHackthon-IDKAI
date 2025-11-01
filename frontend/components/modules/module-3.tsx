"use client"

import { ModuleLayout } from "./module-layout"
import { useState, useEffect, useRef } from "react"

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
  const graphRef = useRef<HTMLDivElement>(null)

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
    // Load cached input data immediately
    const cachedInput = localStorage.getItem('module3_input')
    if (cachedInput) {
      setInputData(JSON.parse(cachedInput))
    } else {
      setInputData(fallbackInput)
      localStorage.setItem('module3_input', JSON.stringify(fallbackInput))
    }
    
    // Check if backend is running
    checkBackendStatus()
  }, [])

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
              const leftist = allPerspectives.filter(p => p.bias_x < -0.3)
              const rightist = allPerspectives.filter(p => p.bias_x > 0.3)
              const common = allPerspectives.filter(p => p.bias_x >= -0.3 && p.bias_x <= 0.3)
              
              setFinalOutput({ leftist, rightist, common })
              console.log(`Clustering: ${leftist.length} leftist, ${common.length} common, ${rightist.length} rightist`)
              
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
        {/* Backend Control */}
        <div className="border border-white/10 rounded p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className={`w-2 h-2 rounded-full ${backendRunning ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                <span className="text-sm text-white/70">
                  Backend Status: {backendRunning ? 'Running' : 'Not Running'}
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
                      Starting Backend...
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
                    <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center text-sm font-light transition-all duration-300 ${
                      index === currentStep
                        ? 'border-white bg-white text-black scale-110 shadow-lg shadow-white/20'
                        : index < currentStep
                        ? 'border-white/50 bg-white/10 text-white/70 hover:border-white hover:bg-white/20'
                        : 'border-white/20 bg-transparent text-white/40 hover:border-white/40'
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
                      : index < currentStep
                      ? 'text-white/60 text-xs hover:text-white/80'
                      : 'text-white/30 text-xs'
                  }`}>
                    <div className="font-light">{step.name}</div>
                    {index === currentStep && (
                      <div className="text-[10px] text-white/50 mt-1 animate-fadeIn">
                        {step.description}
                      </div>
                    )}
                  </div>
                  
                  {/* Connection Line */}
                  {index < steps.length - 1 && (
                    <div className={`absolute top-5 left-[60%] w-full h-[2px] transition-all duration-500 ${
                      index < currentStep ? 'bg-white/60' : 'bg-white/10'
                    }`} style={{ width: 'calc(100% - 40px)' }} />
                  )}
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
                      <span className="text-xs text-green-400 animate-pulse">Generating...</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Perspectives grouped by color */}
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {['red', 'orange', 'yellow', 'green', 'blue', 'indigo', 'violet'].map(color => {
                  const colorPerspectives = perspectives.filter(p => p.color === color)
                  if (colorPerspectives.length === 0) return null
                  
                  return (
                    <div key={color} className="border border-white/10 rounded overflow-hidden animate-slideIn">
                      <div className={`px-4 py-2 border-b border-white/10 flex items-center gap-3 bg-black/20`}>
                        <div className={`w-3 h-3 rounded-full ${getColorClass(color)}`} />
                        <span className="text-sm text-white/70 font-light uppercase tracking-wider">{getColorName(color)}</span>
                        <span className="ml-auto text-xs text-white/40">{colorPerspectives.length} perspectives</span>
                      </div>
                      <div className="p-3 space-y-2">
                        {colorPerspectives.slice(0, 3).map((perspective, index) => (
                          <div key={`${color}-${index}`} className="p-3 bg-black/10 rounded border border-white/5">
                            <div className="flex items-center gap-2 mb-1.5 text-xs text-white/40">
                              <span>Bias: {perspective.bias_x.toFixed(3)}</span>
                              <span>•</span>
                              <span>Significance: {perspective.significance_y.toFixed(3)}</span>
                            </div>
                            <p className="text-sm text-white/60 leading-relaxed line-clamp-2">{perspective.text}</p>
                          </div>
                        ))}
                        {colorPerspectives.length > 3 && (
                          <div className="text-xs text-white/30 text-center py-1">
                            +{colorPerspectives.length - 3} more
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
                {isGenerating && perspectives.length === 0 && (
                  <div className="flex items-center justify-center h-32">
                    <div className="flex gap-2">
                      <div className="w-2 h-2 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-2 h-2 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-2 h-2 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-6">
              <h3 className="text-base font-light text-white/70 mb-6">Visualisation ({perspectives.length} perspectives)</h3>
              
              {/* Clustering Summary */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                <div className="p-5 border border-white/10 rounded">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 rounded-full bg-red-500" />
                    <div className="text-xs text-white/40">Leftist</div>
                  </div>
                  <div className="text-white text-2xl font-light">
                    {finalOutput ? finalOutput.leftist.length : '...'}
                  </div>
                </div>
                <div className="p-5 border border-white/10 rounded">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    <div className="text-xs text-white/40">Common</div>
                  </div>
                  <div className="text-white text-2xl font-light">
                    {finalOutput ? finalOutput.common.length : '...'}
                  </div>
                </div>
                <div className="p-5 border border-white/10 rounded">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 rounded-full bg-blue-500" />
                    <div className="text-xs text-white/40">Rightist</div>
                  </div>
                  <div className="text-white text-2xl font-light">
                    {finalOutput ? finalOutput.rightist.length : '...'}
                  </div>
                </div>
              </div>

              {/* Animated Graph */}
              {showGraph && perspectives.length > 0 && (
                <div className="p-6 border border-white/10 rounded">
                  <div className="text-xs text-white/40 mb-4">Bias × Significance Distribution</div>
                  <div ref={graphRef} className="relative w-full h-96 bg-black/20 rounded border border-white/10">
                    {/* Y-axis */}
                    <div className="absolute left-0 top-0 bottom-0 w-12 flex flex-col justify-between py-4 text-xs text-white/40">
                      <span>1.0</span>
                      <span>0.8</span>
                      <span>0.6</span>
                      <span>0.4</span>
                      <span>0.2</span>
                      <span>0.0</span>
                    </div>
                    
                    {/* X-axis */}
                    <div className="absolute bottom-0 left-12 right-0 h-8 flex justify-between px-4 text-xs text-white/40 items-center">
                      <span>-1.0</span>
                      <span>-0.5</span>
                      <span>0.0</span>
                      <span>0.5</span>
                      <span>1.0</span>
                    </div>
                    
                    {/* Grid */}
                    <div className="absolute left-12 top-4 right-4 bottom-8">
                      {/* Vertical center line */}
                      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/10" />
                      {/* Horizontal center line */}
                      <div className="absolute top-1/2 left-0 right-0 h-px bg-white/10" />
                      
                      {/* Data points */}
                      <div className="relative w-full h-full">
                        {perspectives.map((p, index) => {
                          const x = ((p.bias_x + 1) / 2) * 100 // Convert -1 to 1 → 0 to 100%
                          const y = (1 - p.significance_y) * 100 // Invert Y axis
                          
                          return (
                            <div
                              key={index}
                              className={`absolute w-3 h-3 rounded-full ${getColorClass(p.color)} opacity-0 animate-fadeIn cursor-pointer hover:scale-150 transition-transform`}
                              style={{
                                left: `${x}%`,
                                top: `${y}%`,
                                transform: 'translate(-50%, -50%)',
                                animationDelay: `${index * 0.03}s`,
                                animationFillMode: 'forwards'
                              }}
                              title={`${getColorName(p.color)}: ${p.text.substring(0, 50)}...`}
                            />
                          )
                        })}
                      </div>
                    </div>
                    
                    {/* Labels */}
                    <div className="absolute top-2 left-1/2 transform -translate-x-1/2 text-xs text-white/40">
                      Bias →
                    </div>
                    <div className="absolute left-2 top-1/2 transform -translate-y-1/2 -rotate-90 text-xs text-white/40">
                      Significance →
                    </div>
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
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-5 border border-white/10 rounded">
                      <div className="text-xs text-white/40 mb-2">leftist.json</div>
                      <div className="text-white/80">{finalOutput.leftist.length} items</div>
                    </div>
                    <div className="p-5 border border-white/10 rounded">
                      <div className="text-xs text-white/40 mb-2">common.json</div>
                      <div className="text-white/80">{finalOutput.common.length} items</div>
                    </div>
                    <div className="p-5 border border-white/10 rounded">
                      <div className="text-xs text-white/40 mb-2">rightist.json</div>
                      <div className="text-white/80">{finalOutput.rightist.length} items</div>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-white/40 text-sm">Final output files will appear here after pipeline completion</p>
              )}
            </div>
          )}
        </div>
      </div>
    </ModuleLayout>
  )
}



