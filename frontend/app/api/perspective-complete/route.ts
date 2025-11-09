import { NextResponse } from 'next/server'

type PerspectiveCompletePayload = Record<string, unknown>

interface PerspectiveCompleteEvent extends PerspectiveCompletePayload {
  type: string
}

type PerspectiveCompleteListener = (data: PerspectiveCompleteEvent) => void

type ListenerRecord = {
  sessionId: string | null
  listener: PerspectiveCompleteListener
}

const listeners = new Set<ListenerRecord>()

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

export async function POST(request: Request) {
  try {
    const rawData = await request.json()
    const data: PerspectiveCompletePayload = isRecord(rawData) ? rawData : {}
    const sessionId = typeof data.session_id === 'string' ? data.session_id : null
    const totalPerspectives = typeof data.total_perspectives === 'number' ? data.total_perspectives : 'unknown'
    console.log(`[Pipeline Complete] Generated ${totalPerspectives} perspectives`)

    const event: PerspectiveCompleteEvent = {
      ...data,
      type: typeof data.type === 'string' ? (data.type as string) : 'complete'
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
    console.error('Error handling perspective complete:', error)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

// SSE endpoint for completion notifications
export async function GET(request: Request) {
  const encoder = new TextEncoder()
  let keepAlive: ReturnType<typeof setInterval> | null = null
  let listenerRecord: ListenerRecord | null = null
  const url = new URL(request.url)
  const sessionId = url.searchParams.get('session_id')
  
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
      
      listenerRecord = { sessionId, listener }
      listeners.add(listenerRecord)
      
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
          console.log('[SSE] Client disconnected for completions')
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

