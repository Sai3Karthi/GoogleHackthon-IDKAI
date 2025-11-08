import { NextResponse } from 'next/server'

const listeners = new Set<(data: any) => void>()

export async function POST(request: Request) {
  try {
    const payload = await request.json()
    listeners.forEach(listener => {
      try {
        listener({ type: 'message', ...payload })
      } catch (error) {
        console.error('[debate-update] Listener error:', error)
      }
    })
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[debate-update] POST handler failed:', error)
    return NextResponse.json({ success: false, error: error?.message ?? 'Unknown error' }, { status: 500 })
  }
}

export async function GET() {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      console.log('[debate-update] SSE client connected')
      const listener = (data: any) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch (error) {
          console.error('[debate-update] Failed to enqueue SSE data:', error)
        }
      }

      listeners.add(listener)
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected' })}\n\n`))

      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
        } catch (error) {
          clearInterval(keepAlive)
          listeners.delete(listener)
          console.log('[debate-update] SSE client disconnected')
        }
      }, 15000)
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
