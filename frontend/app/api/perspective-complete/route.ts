import { NextResponse } from 'next/server'

type PerspectiveCompletePayload = Record<string, unknown>

interface PerspectiveCompleteEvent extends PerspectiveCompletePayload {
  type: string
}

type PerspectiveCompleteListener = (data: PerspectiveCompleteEvent) => void

const listeners = new Set<PerspectiveCompleteListener>()

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

export async function POST(request: Request) {
  try {
    const rawData = await request.json()
    const data: PerspectiveCompletePayload = isRecord(rawData) ? rawData : {}
    const totalPerspectives = typeof data.total_perspectives === 'number' ? data.total_perspectives : 'unknown'
    console.log(`[Pipeline Complete] Generated ${totalPerspectives} perspectives`)

    const event: PerspectiveCompleteEvent = {
      ...data,
      type: typeof data.type === 'string' ? (data.type as string) : 'complete'
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
    console.error('Error handling perspective complete:', error)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

// SSE endpoint for completion notifications
export async function GET() {
  const encoder = new TextEncoder()
  let keepAlive: ReturnType<typeof setInterval> | null = null
  let activeListener: PerspectiveCompleteListener | null = null
  
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      console.log('[SSE] Client connected for completion notifications')
      
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected' })}\n\n`))
      
      const listener: PerspectiveCompleteListener = (data) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch (enqueueError) {
          console.error('[SSE] Error sending data:', enqueueError)
        }
      }
      
      listeners.add(listener)
      activeListener = listener
      
      keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
        } catch {
          if (keepAlive) {
            clearInterval(keepAlive)
            keepAlive = null
          }
          listeners.delete(listener)
          console.log('[SSE] Client disconnected for completions')
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

