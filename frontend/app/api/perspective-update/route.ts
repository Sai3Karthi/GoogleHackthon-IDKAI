import { NextResponse } from 'next/server'

type PerspectiveUpdatePayload = Record<string, unknown>

interface PerspectiveUpdateEvent extends PerspectiveUpdatePayload {
  type: string
}

type PerspectiveUpdateListener = (data: PerspectiveUpdateEvent) => void

type ListenerRecord = {
  sessionId: string | null
  listener: PerspectiveUpdateListener
}

const listeners = new Set<ListenerRecord>()

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

// Store for event listeners
export async function POST(request: Request) {
  try {
    const rawData = await request.json()
    const data: PerspectiveUpdatePayload = isRecord(rawData) ? rawData : {}
    const sessionId = typeof data.session_id === 'string' ? data.session_id : null
    const color = typeof data.color === 'string' ? data.color : 'unknown'
    const total = typeof data.count === 'number' ? data.count : 'unknown'
    const batchSize = typeof data.batch_size === 'number' ? data.batch_size : 'unknown'
    console.log(`[Batch Update] ${color}: ${total} total perspectives (${batchSize} new)`)
    
    const event: PerspectiveUpdateEvent = {
      ...data,
      type: typeof data.type === 'string' ? (data.type as string) : 'batch'
    }
    
    listeners.forEach(({ sessionId: listenerSessionId, listener }) => {
      try {
        if (sessionId && listenerSessionId && listenerSessionId !== sessionId) {
          return
        }
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
export async function GET(request: Request) {
  const encoder = new TextEncoder()
  let keepAlive: ReturnType<typeof setInterval> | null = null
  let listenerRecord: ListenerRecord | null = null
  const url = new URL(request.url)
  const sessionId = url.searchParams.get('session_id')
  
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
      
      listenerRecord = { sessionId, listener }
      listeners.add(listenerRecord)
      
      // Cleanup on disconnect
      keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
        } catch {
          if (keepAlive) {
            clearInterval(keepAlive)
            keepAlive = null
          }
          if (listenerRecord) {
            listeners.delete(listenerRecord)
          }
          console.log('[SSE] Client disconnected')
        }
      }, 15000)
    },
    cancel() {
      if (keepAlive) {
        clearInterval(keepAlive)
        keepAlive = null
      }
      if (listenerRecord) {
        listeners.delete(listenerRecord)
        listenerRecord = null
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

