import { NextResponse } from 'next/server'

type DebateCompletePayload = Record<string, unknown>

interface DebateCompleteEvent extends DebateCompletePayload {
  type: string
}

type DebateCompleteListener = (data: DebateCompleteEvent) => void

const listeners = new Set<DebateCompleteListener>()

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

export async function POST(request: Request) {
  try {
    const rawPayload = await request.json()
    const payload: DebateCompletePayload = isRecord(rawPayload) ? rawPayload : {}
    const event: DebateCompleteEvent = {
      ...payload,
      type: typeof payload.type === 'string' ? (payload.type as string) : 'complete'
    }

    listeners.forEach(listener => {
      try {
        listener(event)
      } catch (listenerError) {
        console.error('[debate-complete] Listener error:', listenerError)
      }
    })
    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[debate-complete] POST handler failed:', error)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function GET() {
  const encoder = new TextEncoder()

  let keepAlive: ReturnType<typeof setInterval> | null = null
  let activeListener: DebateCompleteListener | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      console.log('[debate-complete] SSE client connected')

      const listener: DebateCompleteListener = (data) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch (enqueueError) {
          console.error('[debate-complete] Failed to enqueue SSE data:', enqueueError)
        }
      }

      listeners.add(listener)
      activeListener = listener
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected' })}\n\n`))

      keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
        } catch {
          if (keepAlive) {
            clearInterval(keepAlive)
            keepAlive = null
          }
          listeners.delete(listener)
          console.log('[debate-complete] SSE client disconnected')
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
      Connection: 'keep-alive'
    }
  })
}
