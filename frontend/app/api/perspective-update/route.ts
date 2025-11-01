import { NextResponse } from 'next/server'

// Store for event listeners
const listeners = new Set<(data: any) => void>()

export async function POST(request: Request) {
  try {
    const data = await request.json()
    console.log(`[Batch Update] ${data.color}: ${data.count} total perspectives (${data.batch_size} new)`)
    
    // Notify all listeners
    listeners.forEach(listener => {
      try {
        listener({ type: 'batch', ...data })
      } catch (error) {
        console.error('Error notifying listener:', error)
      }
    })
    
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error handling perspective update:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

// SSE endpoint for real-time updates
export async function GET() {
  const encoder = new TextEncoder()
  
  const stream = new ReadableStream({
    start(controller) {
      console.log('[SSE] Client connected for batch updates')
      
      // Send initial connection message
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected' })}\n\n`))
      
      // Add listener for this client
      const listener = (data: any) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch (error) {
          console.error('[SSE] Error sending data:', error)
        }
      }
      
      listeners.add(listener)
      
      // Cleanup on disconnect
      const timer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
        } catch {
          clearInterval(timer)
          listeners.delete(listener)
          console.log('[SSE] Client disconnected')
        }
      }, 15000)
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

