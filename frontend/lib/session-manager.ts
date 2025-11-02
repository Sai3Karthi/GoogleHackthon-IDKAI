/**
 * Session Manager for Pipeline State Persistence
 * Manages session state across all modules with localStorage
 */

export interface Module1Data {
  input: string
  analysisMode: "text" | "image"
  result: any | null
  timestamp: number
}

export interface Module2Data {
  output: any | null
  timestamp: number
}

export interface Module3Data {
  perspectives: any[]
  finalOutput: {
    leftist: any[]
    rightist: any[]
    common: any[]
  } | null
  inputHash: string
  timestamp: number
}

export interface SessionData {
  sessionId: string
  currentModule: number
  module1?: Module1Data
  module2?: Module2Data
  module3?: Module3Data
  createdAt: number
  lastUpdated: number
}

const SESSION_KEY = 'pipeline_session'
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Get current session or create new one
 */
export function getSession(): SessionData | null {
  try {
    const stored = localStorage.getItem(SESSION_KEY)
    if (!stored) return null

    const session: SessionData = JSON.parse(stored)
    
    // Check if session expired
    const age = Date.now() - session.createdAt
    if (age > SESSION_EXPIRY_MS) {
      console.log('[Session] Session expired, clearing')
      clearSession()
      return null
    }

    return session
  } catch (error) {
    console.error('[Session] Error loading session:', error)
    return null
  }
}

/**
 * Create a new session
 */
export function createSession(currentModule: number = 1): SessionData {
  const session: SessionData = {
    sessionId: generateSessionId(),
    currentModule,
    createdAt: Date.now(),
    lastUpdated: Date.now()
  }

  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    console.log('[Session] New session created:', session.sessionId)
    return session
  } catch (error) {
    console.error('[Session] Error creating session:', error)
    return session
  }
}

/**
 * Update session data
 */
export function updateSession(updates: Partial<SessionData>): void {
  try {
    let session = getSession()
    if (!session) {
      session = createSession()
    }

    const updatedSession: SessionData = {
      ...session,
      ...updates,
      lastUpdated: Date.now()
    }

    localStorage.setItem(SESSION_KEY, JSON.stringify(updatedSession))
    console.log('[Session] Session updated')
  } catch (error) {
    console.error('[Session] Error updating session:', error)
  }
}

/**
 * Save Module 1 data
 */
export function saveModule1Data(data: Omit<Module1Data, 'timestamp'>): void {
  updateSession({
    module1: {
      ...data,
      timestamp: Date.now()
    },
    currentModule: 1
  })
}

/**
 * Get Module 1 data
 */
export function getModule1Data(): Module1Data | null {
  const session = getSession()
  return session?.module1 || null
}

/**
 * Save Module 2 data
 */
export function saveModule2Data(data: Omit<Module2Data, 'timestamp'>): void {
  updateSession({
    module2: {
      ...data,
      timestamp: Date.now()
    },
    currentModule: 2
  })
}

/**
 * Get Module 2 data
 */
export function getModule2Data(): Module2Data | null {
  const session = getSession()
  return session?.module2 || null
}

/**
 * Save Module 3 data
 */
export function saveModule3Data(data: Omit<Module3Data, 'timestamp'>): void {
  updateSession({
    module3: {
      ...data,
      timestamp: Date.now()
    },
    currentModule: 3
  })
}

/**
 * Get Module 3 data
 */
export function getModule3Data(): Module3Data | null {
  const session = getSession()
  return session?.module3 || null
}

/**
 * Update current module
 */
export function setCurrentModule(moduleNumber: number): void {
  updateSession({ currentModule: moduleNumber })
}

/**
 * Clear session
 */
export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY)
    console.log('[Session] Session cleared')
  } catch (error) {
    console.error('[Session] Error clearing session:', error)
  }
}

/**
 * Check if session has module data
 */
export function hasModuleData(moduleNumber: 1 | 2 | 3): boolean {
  const session = getSession()
  if (!session) return false

  switch (moduleNumber) {
    case 1:
      return !!session.module1
    case 2:
      return !!session.module2
    case 3:
      return !!session.module3
    default:
      return false
  }
}

/**
 * Get session progress (which modules have data)
 */
export function getSessionProgress(): { module1: boolean; module2: boolean; module3: boolean } {
  return {
    module1: hasModuleData(1),
    module2: hasModuleData(2),
    module3: hasModuleData(3)
  }
}
