import { NextResponse } from 'next/server'
import { spawn } from 'child_process'
import path from 'path'

let backendProcess: any = null

export async function POST() {
  try {
    // If backend is already running, kill it first
    if (backendProcess && backendProcess.pid) {
      console.log(`Killing existing backend process ${backendProcess.pid}`)
      try {
        backendProcess.kill()
        backendProcess = null
        // Wait a moment for the port to be released
        await new Promise(resolve => setTimeout(resolve, 1000))
      } catch (error) {
        console.error('Error killing existing process:', error)
      }
    }

    // Path to backend directory
    const backendPath = path.join(process.cwd(), '..', 'module3', 'backend')
    
    console.log(`Starting backend from: ${backendPath}`)
    
    // Start backend directly with Python
    backendProcess = spawn('python', ['main.py'], {
      cwd: backendPath,
      shell: true,
      detached: false,
      stdio: 'pipe',
      env: {
        ...process.env,
        PIPELINE_PORT: '8002',  // Explicitly set port to 8002
        PYTHONIOENCODING: 'utf-8',
        PYTHONUNBUFFERED: '1'
      }
    })
    
    console.log('Backend spawn command: python main.py')
    console.log('Backend working directory:', backendPath)
    console.log('Backend port set to: 8002')

    // Track if process had an error
    let processError: string | null = null

    backendProcess.stdout?.on('data', (data: Buffer) => {
      console.log(`Backend: ${data.toString()}`)
    })

    backendProcess.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString()
      // Uvicorn writes INFO logs to stderr, so don't treat them as errors
      if (msg.includes('ERROR') || msg.includes('Error') || msg.includes('error')) {
        console.error(`Backend Error: ${msg}`)
        if (!processError) {
          // Check for port already in use error
          if (msg.includes('10048') || msg.includes('address already in use') || msg.includes('bind on address')) {
            processError = 'PORT_IN_USE'
          } else {
            processError = msg
          }
        }
      } else {
        // INFO logs from uvicorn
        console.log(`Backend: ${msg}`)
      }
    })

    backendProcess.on('error', (error: Error) => {
      console.error(`Failed to start backend: ${error.message}`)
      processError = error.message
      backendProcess = null
    })

    backendProcess.on('close', (code: number) => {
      console.log(`Backend process exited with code ${code}`)
      if (code !== 0 && !processError) {
        processError = `Backend exited with error code ${code}`
      }
      backendProcess = null
    })

    backendProcess.on('exit', (code: number, signal: string | null) => {
      console.error(`Backend process exited unexpectedly! Code: ${code}, Signal: ${signal}`)
      if (code !== 0) {
        processError = `Backend crashed with exit code ${code}`
      }
    })

    // Wait a moment for the process to initialize
    await new Promise(resolve => setTimeout(resolve, 500))

    // Check if process started successfully
    if (!backendProcess || !backendProcess.pid) {
      return NextResponse.json({ 
        success: false, 
        error: 'Failed to start backend process. Make sure Python is installed and accessible.'
      }, { status: 500 })
    }

    console.log(`Backend process started with PID: ${backendProcess.pid}`)

    // Wait for the server to fully start
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Check if process is still running (only fail if it actually exited with an error)
    if (!backendProcess || !backendProcess.pid) {
      let errorMessage = 'Backend process exited immediately. Check the terminal logs for errors.'
      
      if (processError === 'PORT_IN_USE') {
        errorMessage = 'PORT_IN_USE: Port 8002 is already in use. Kill the existing Python process or restart your computer.'
      } else if (processError) {
        errorMessage = processError
      }
      
      return NextResponse.json({ 
        success: false, 
        error: errorMessage
      }, { status: 500 })
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Backend started successfully',
      pid: backendProcess.pid
    })
  } catch (error: any) {
    console.error('Error starting backend:', error)
    backendProcess = null
    return NextResponse.json({ 
      success: false, 
      error: error.message || 'Unknown error occurred'
    }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    if (backendProcess) {
      backendProcess.kill()
      backendProcess = null
      return NextResponse.json({ 
        success: true, 
        message: 'Backend stopped successfully' 
      })
    }
    return NextResponse.json({ 
      success: true, 
      message: 'Backend is not running' 
    })
  } catch (error: any) {
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 })
  }
}

