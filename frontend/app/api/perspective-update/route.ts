import { NextResponse } from 'next/server'

type PerspectiveUpdatePayload = Record<string, unknown>

interface PerspectiveUpdateEvent extends PerspectiveUpdatePayload {
  type: string
}

type PerspectiveUpdateListener = (data: PerspectiveUpdateEvent) => void

const listeners = new Set<PerspectiveUpdateListener>()

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

// Store for event listeners
export async function POST(request: Request) {
  try {
    const rawData = await request.json()
    const data: PerspectiveUpdatePayload = isRecord(rawData) ? rawData : {}
    const color = typeof data.color === 'string' ? data.color : 'unknown'
    const total = typeof data.count === 'number' ? data.count : 'unknown'
    const batchSize = typeof data.batch_size === 'number' ? data.batch_size : 'unknown'
    console.log(`[Batch Update] ${color}: ${total} total perspectives (${batchSize} new)`)
    
    const event: PerspectiveUpdateEvent = {
      ...data,
      type: typeof data.type === 'string' ? (data.type as string) : 'batch'
    }
    
    listeners.forEach(listener => {
      try {
        listener(event)
      } catch (listenerError) {
        console.error('Error notifying listener:', listenerError)
      }
    })
    
    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Error handling perspective update:', error)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

// SSE endpoint for real-time updates
export async function GET() {
  const encoder = new TextEncoder()
  let keepAlive: ReturnType<typeof setInterval> | null = null
  let activeListener: PerspectiveUpdateListener | null = null
  
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      console.log('[SSE] Client connected for batch updates')
      
      // Send initial connection message
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected' })}\n\n`))
      
      // Add listener for this client
      const listener: PerspectiveUpdateListener = (data) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch (enqueueError) {
          console.error('[SSE] Error sending data:', enqueueError)
        }
      }
      
      listeners.add(listener)
      activeListener = listener
      
      // Cleanup on disconnect
      keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
        } catch {
          if (keepAlive) {
            clearInterval(keepAlive)
            keepAlive = null
          }
          listeners.delete(listener)
          console.log('[SSE] Client disconnected')
        }
      }, 15000)
    },
    cancel() {
      if (keepAlive) {
        clearInterval(keepAlive)
        keepAlive = null
      }
      if (activeListener) {
        listeners.delete(activeListener)
        activeListener = null
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}

