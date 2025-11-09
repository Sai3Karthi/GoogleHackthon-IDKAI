import { NextResponse } from 'next/server'
import { spawn, execSync } from 'child_process'
import type { ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs'

let backendProcess: ChildProcess | null = null

const BACKEND_PORT = 8002
const MAX_STARTUP_WAIT = 15000
const CLEANUP_RETRIES = 3
const CLEANUP_WAIT = 2000
const NETSTAT_WAIT_STATES = /(TIME_WAIT|CLOSE_WAIT|FIN_WAIT_1|FIN_WAIT_2|LAST_ACK|CLOSING)/i

function filterActiveNetstatLines(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .filter(line => !NETSTAT_WAIT_STATES.test(line))
}

function extractPids(lines: string[]): string[] {
  const pids = new Set<string>()
  lines.forEach(line => {
    const match = line.match(/(\d+)\s*$/)
    const pid = match?.[1]
    if (pid && pid !== '0') {
      pids.add(pid)
    }
  })
  return Array.from(pids)
}

function checkPythonInstallation(): { success: boolean; version?: string; error?: string } {
  try {
    const version = execSync('python --version', { encoding: 'utf-8', timeout: 5000 })
    return { success: true, version: version.trim() }
  } catch {
    return { success: false, error: 'Python not found in PATH' }
  }
}

async function killExistingBackend(): Promise<void> {
  if (backendProcess?.pid) {
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /F /PID ${backendProcess.pid}`, { stdio: 'ignore', timeout: 3000 })
      } else {
        backendProcess.kill('SIGKILL')
      }
      backendProcess = null
      await new Promise(resolve => setTimeout(resolve, 800))
    } catch {}
  }

  if (process.platform === 'win32') {
    try {
      const output = execSync(`netstat -ano | findstr :${BACKEND_PORT}`, {
        encoding: 'utf-8',
        timeout: 3000
      })
      const relevantLines = filterActiveNetstatLines(output)
      const pids = extractPids(relevantLines)

      pids.forEach(pid => {
        try {
          execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', timeout: 3000 })
        } catch {}
      })
      
      await new Promise(resolve => setTimeout(resolve, 1000))
    } catch {}
  } else {
    try {
      execSync(`lsof -ti:${BACKEND_PORT} | xargs kill -9`, { stdio: 'ignore', timeout: 3000 })
    } catch {}
    try {
      execSync('pkill -f "python.*main.py"', { stdio: 'ignore', timeout: 3000 })
    } catch {}
  }
  
  await new Promise(resolve => setTimeout(resolve, 800))
}

export async function POST() {
  try {
    const pythonCheck = checkPythonInstallation()
    if (!pythonCheck.success) {
      return NextResponse.json({ 
        success: false, 
        error: 'Python not found. Please install Python and add it to PATH.'
      }, { status: 500 })
    }

    const backendPath = path.join(process.cwd(), '..', 'module3', 'backend')
    const mainPyPath = path.join(backendPath, 'main.py')
    
    if (!fs.existsSync(mainPyPath)) {
      return NextResponse.json({ 
        success: false, 
        error: 'Backend files not found. Please check installation.'
      }, { status: 500 })
    }

    await killExistingBackend()
    await new Promise(resolve => setTimeout(resolve, CLEANUP_WAIT))
    
    let portFree = false
    let retries = CLEANUP_RETRIES
    
    while (!portFree && retries > 0) {
      try {
        if (process.platform === 'win32') {
          const portCheck = execSync(`netstat -ano | findstr :${BACKEND_PORT}`, { 
            encoding: 'utf-8',
            timeout: 3000
          })
          const relevantLines = filterActiveNetstatLines(portCheck)
          if (relevantLines.length > 0) {
            retries--
            if (retries > 0) {
              await killExistingBackend()
              await new Promise(resolve => setTimeout(resolve, CLEANUP_WAIT))
            } else {
              return NextResponse.json({ 
                success: false, 
                error: 'PORT_IN_USE',
                details: `Port ${BACKEND_PORT} is still occupied. Please run kill-backend.bat manually.`
              }, { status: 500 })
            }
          } else {
            portFree = true
          }
        } else {
          portFree = true
        }
      } catch {
        portFree = true
      }
    }

    backendProcess = spawn('python', ['main.py'], {
      cwd: backendPath,
      shell: true,
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PIPELINE_PORT: String(BACKEND_PORT),
        PYTHONIOENCODING: 'utf-8',
        PYTHONUNBUFFERED: '1'
      }
    })

    let startupError: string | null = null
    let startupSuccess = false

    backendProcess.on('error', (error: Error) => {
      startupError = error.message
      backendProcess = null
    })

    backendProcess.on('exit', (code: number | null) => {
      if (!startupSuccess) {
        startupError = `Process exited with code ${code}`
      }
      backendProcess = null
    })

    backendProcess.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString()
      if (msg.includes('Uvicorn running on') || msg.includes('Application startup complete')) {
        startupSuccess = true
      }
    })

    backendProcess.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString()
      if (msg.includes('ERROR') || msg.includes('Traceback')) {
        if (!startupError) {
          startupError = msg.includes('10048') || msg.includes('address already in use') 
            ? 'PORT_IN_USE' 
            : 'Startup error occurred'
        }
      } else if (msg.includes('Uvicorn running on') || msg.includes('Application startup complete')) {
        startupSuccess = true
      }
    })

    await new Promise(resolve => setTimeout(resolve, 1000))

    if (!backendProcess?.pid) {
      return NextResponse.json({ 
        success: false, 
        error: startupError || 'Failed to start backend. Check Python dependencies.'
      }, { status: 500 })
    }

    const startTime = Date.now()
    while (Date.now() - startTime < MAX_STARTUP_WAIT) {
      if (startupSuccess) break
      
      if (startupError) {
        backendProcess = null
        return NextResponse.json({ 
          success: false, 
          error: startupError === 'PORT_IN_USE' 
            ? `Port ${BACKEND_PORT} is already in use.` 
            : 'Backend startup failed.'
        }, { status: 500 })
      }
      
      if (!backendProcess?.pid) {
        return NextResponse.json({ 
          success: false, 
          error: 'Backend process terminated unexpectedly.'
        }, { status: 500 })
      }
      
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    
    return NextResponse.json({ 
      success: true, 
      message: 'Backend started successfully',
      pid: backendProcess.pid,
      port: BACKEND_PORT
    })

  } catch (error: unknown) {
    backendProcess = null
    const message = error instanceof Error ? error.message : 'Unexpected error occurred'
    return NextResponse.json({ 
      success: false, 
      error: message
    }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    if (backendProcess?.pid) {
      if (process.platform === 'win32') {
        execSync(`taskkill /F /PID ${backendProcess.pid}`, { stdio: 'ignore', timeout: 3000 })
      } else {
        backendProcess.kill('SIGKILL')
      }
      backendProcess = null
      return NextResponse.json({ success: true, message: 'Backend stopped successfully' })
    }
    return NextResponse.json({ success: true, message: 'Backend is not running' })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to stop backend'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function GET() {
  try {
    let portInUse = false
    try {
      if (process.platform === 'win32') {
        const output = execSync(`netstat -ano | findstr :${BACKEND_PORT}`, { 
          encoding: 'utf-8',
          timeout: 3000
        })
        portInUse = filterActiveNetstatLines(output).length > 0
      }
    } catch {}

    return NextResponse.json({ 
      success: true,
      backendRunning: !!backendProcess?.pid,
      pid: backendProcess?.pid || null,
      portInUse,
      port: BACKEND_PORT
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to inspect backend state'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function PATCH() {
  try {
    await killExistingBackend()
    await new Promise(resolve => setTimeout(resolve, 1500))
    
    let portStillInUse = false
    try {
      if (process.platform === 'win32') {
        const output = execSync(`netstat -ano | findstr :${BACKEND_PORT}`, { 
          encoding: 'utf-8',
          timeout: 3000
        })
        portStillInUse = filterActiveNetstatLines(output).length > 0
      }
    } catch {}

    if (portStillInUse) {
      return NextResponse.json({ 
        success: false,
        error: 'PORT_STILL_IN_USE',
        message: `Failed to free port ${BACKEND_PORT}. Run kill-backend.bat manually.`
      }, { status: 500 })
    }

    return NextResponse.json({ 
      success: true,
      message: `Port ${BACKEND_PORT} is now available.`
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to reset backend port'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
