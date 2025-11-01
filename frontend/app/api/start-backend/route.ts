import { NextResponse } from 'next/server'
import { spawn, execSync } from 'child_process'
import path from 'path'
import fs from 'fs'

let backendProcess: any = null

/**
 * Check if Python is installed and accessible
 */
function checkPythonInstallation(): { success: boolean; version?: string; error?: string } {
  try {
    const version = execSync('python --version', { encoding: 'utf-8' })
    return { success: true, version: version.trim() }
  } catch (error) {
    return { success: false, error: 'Python not found in PATH' }
  }
}

/**
 * Kill any existing process on port 8002
 */
async function killExistingBackend(): Promise<void> {
  if (backendProcess?.pid) {
    console.log(`[Backend] Killing existing process PID: ${backendProcess.pid}`)
    try {
      process.platform === 'win32'
        ? execSync(`taskkill /F /PID ${backendProcess.pid}`, { stdio: 'ignore' })
        : backendProcess.kill()
      backendProcess = null
      await new Promise(resolve => setTimeout(resolve, 1000))
    } catch (error) {
      console.error('[Backend] Error killing process:', error)
    }
  }

  // Kill any Python process on port 8002
  try {
    if (process.platform === 'win32') {
      execSync('netstat -ano | findstr :8002', { encoding: 'utf-8' })
        .split('\n')
        .forEach(line => {
          const match = line.match(/\s+(\d+)$/)
          if (match) {
            try {
              execSync(`taskkill /F /PID ${match[1]}`, { stdio: 'ignore' })
              console.log(`[Backend] Killed process on port 8002: PID ${match[1]}`)
            } catch {}
          }
        })
    } else {
      execSync('lsof -ti:8002 | xargs kill -9', { stdio: 'ignore' })
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  } catch {
    // No process on port, continue
  }
}

export async function POST() {
  try {
    console.log('\n[Backend] ========== STARTING BACKEND ==========')
    
    // Step 1: Check Python installation
    const pythonCheck = checkPythonInstallation()
    if (!pythonCheck.success) {
      return NextResponse.json({ 
        success: false, 
        error: 'Python not found. Please install Python and add it to PATH.',
        details: pythonCheck.error
      }, { status: 500 })
    }
    console.log(`[Backend] Python found: ${pythonCheck.version}`)

    // Step 2: Verify backend directory exists
    const backendPath = path.join(process.cwd(), '..', 'module3', 'backend')
    if (!fs.existsSync(backendPath)) {
      return NextResponse.json({ 
        success: false, 
        error: `Backend directory not found: ${backendPath}`
      }, { status: 500 })
    }
    console.log(`[Backend] Backend directory verified: ${backendPath}`)

    // Step 3: Verify main.py exists
    const mainPyPath = path.join(backendPath, 'main.py')
    if (!fs.existsSync(mainPyPath)) {
      return NextResponse.json({ 
        success: false, 
        error: `main.py not found at: ${mainPyPath}`
      }, { status: 500 })
    }
    console.log(`[Backend] main.py verified`)

    // Step 4: Kill existing backend
    await killExistingBackend()

    // Step 5: Start backend process
    console.log('[Backend] Spawning Python process...')
    backendProcess = spawn('python', ['main.py'], {
      cwd: backendPath,
      shell: true,
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PIPELINE_PORT: '8002',
        PYTHONIOENCODING: 'utf-8',
        PYTHONUNBUFFERED: '1'
      }
    })

    // Track startup state
    let startupError: string | null = null
    let startupSuccess = false

    // Handle process events
    backendProcess.on('error', (error: Error) => {
      console.error(`[Backend] Process error: ${error.message}`)
      startupError = error.message
      backendProcess = null
    })

    backendProcess.on('exit', (code: number | null, signal: string | null) => {
      console.error(`[Backend] Process exited - Code: ${code}, Signal: ${signal}`)
      if (!startupSuccess) {
        startupError = `Process exited with code ${code}`
      }
      backendProcess = null
    })

    // Capture stdout
    backendProcess.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString()
      console.log(`[Backend OUT] ${msg}`)
      
      // Check for successful startup
      if (msg.includes('Uvicorn running on') || msg.includes('Application startup complete')) {
        startupSuccess = true
      }
    })

    // Capture stderr
    backendProcess.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString()
      
      // Uvicorn logs to stderr
      if (msg.includes('ERROR') || msg.includes('Traceback')) {
        console.error(`[Backend ERR] ${msg}`)
        if (!startupError) {
          if (msg.includes('10048') || msg.includes('address already in use')) {
            startupError = 'PORT_IN_USE'
          } else {
            startupError = msg.trim()
          }
        }
      } else {
        console.log(`[Backend INFO] ${msg}`)
        if (msg.includes('Uvicorn running on') || msg.includes('Application startup complete')) {
          startupSuccess = true
        }
      }
    })

    // Step 6: Wait for process to initialize
    console.log('[Backend] Waiting for process to initialize...')
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Step 7: Verify process is running
    if (!backendProcess?.pid) {
      const errorMsg = startupError || 'Process failed to start. Check if Python dependencies are installed.'
      console.error(`[Backend] ${errorMsg}`)
      return NextResponse.json({ 
        success: false, 
        error: errorMsg
      }, { status: 500 })
    }

    console.log(`[Backend] Process started with PID: ${backendProcess.pid}`)

    // Step 8: Wait for server to be ready
    console.log('[Backend] Waiting for server to be ready...')
    const maxWaitTime = 15000 // 15 seconds
    const startTime = Date.now()
    
    while (Date.now() - startTime < maxWaitTime) {
      if (startupSuccess) {
        console.log('[Backend] Server ready!')
        break
      }
      
      if (startupError) {
        const errorMsg = startupError === 'PORT_IN_USE' 
          ? 'Port 8002 is already in use. Please restart your computer or kill the process manually.'
          : startupError
        
        console.error(`[Backend] Startup failed: ${errorMsg}`)
        backendProcess = null
        return NextResponse.json({ 
          success: false, 
          error: errorMsg
        }, { status: 500 })
      }
      
      if (!backendProcess?.pid) {
        console.error('[Backend] Process died during startup')
        return NextResponse.json({ 
          success: false, 
          error: 'Backend process exited during startup. Check terminal logs for errors.'
        }, { status: 500 })
      }
      
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    // Final verification
    if (!startupSuccess) {
      console.warn('[Backend] Server started but no confirmation message received')
    }

    console.log('[Backend] ========== BACKEND STARTED SUCCESSFULLY ==========\n')
    
    return NextResponse.json({ 
      success: true, 
      message: 'Backend started successfully',
      pid: backendProcess.pid,
      port: 8002
    })

  } catch (error: any) {
    console.error('[Backend] Unexpected error:', error)
    backendProcess = null
    return NextResponse.json({ 
      success: false, 
      error: error.message || 'Unexpected error occurred',
      stack: error.stack
    }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    if (backendProcess?.pid) {
      console.log(`[Backend] Stopping backend PID: ${backendProcess.pid}`)
      
      if (process.platform === 'win32') {
        execSync(`taskkill /F /PID ${backendProcess.pid}`, { stdio: 'ignore' })
      } else {
        backendProcess.kill()
      }
      
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
    console.error('[Backend] Error stopping:', error)
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 })
  }
}
