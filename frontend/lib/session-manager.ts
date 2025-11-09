/**
 * Session Manager for Pipeline State Persistence
 * Manages session state across all modules with localStorage
 */

import type {
  AnalysisResult,
  Module2Output,
  ModuleAnalysisMode,
  Perspective,
  PerspectiveClusters,
  DebateResult,
  EnrichmentResult
} from "./pipeline-types"

export interface Module1Data {
  input: string
  analysisMode: ModuleAnalysisMode
  result: AnalysisResult | null
  timestamp: number
}

export interface Module2Data {
  output: Module2Output | null
  timestamp: number
}

export interface Module3Data {
  perspectives: Perspective[]
  finalOutput: PerspectiveClusters | null
  inputHash: string
  autoAdvanceConsumed?: boolean
  lastStep?: number
  firstViewConsumed?: boolean
  timestamp: number
}

export interface Module4Data {
  debateResult: DebateResult | null
  enrichmentResult?: EnrichmentResult | null
  enrichmentEnabled?: boolean
  timestamp: number
}

export interface FinalAnalysisData {
  summary: string
  keyLearnings: string[]
  contentType: string
  timestamp: number
}

export interface SessionData {
  sessionId: string | null
  currentModule: number
  module1?: Module1Data
  module2?: Module2Data
  module3?: Module3Data
  module4?: Module4Data
  finalAnalysis?: FinalAnalysisData
  pipelineCompleted?: boolean
  createdAt: number
  lastUpdated: number
}

const SESSION_KEY = 'pipeline_session'
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000 // 24 hours

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
  } catch (error: unknown) {
    console.error('[Session] Error loading session:', error)
    return null
  }
}

/**
 * Create a new session
 */
export function createSession(currentModule: number = 1, sessionId: string | null = null): SessionData {
  const session: SessionData = {
    sessionId,
    currentModule,
    createdAt: Date.now(),
    lastUpdated: Date.now()
  }

  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    console.log('[Session] New session created:', session.sessionId ?? 'pending')
    return session
  } catch (error: unknown) {
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
  } catch (error: unknown) {
    console.error('[Session] Error updating session:', error)
  }
}

export function setSessionId(sessionId: string): void {
  if (!sessionId) {
    console.warn('[Session] Ignoring empty sessionId update')
    return
  }

  updateSession({ sessionId })
}

export function getSessionId(): string | null {
  const session = getSession()
  return session?.sessionId ?? null
}

export function requireSessionId(): string {
  const sessionId = getSessionId()
  if (!sessionId) {
    throw new Error('No active pipeline session found. Run Module 1 analysis first.')
  }
  return sessionId
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
export function saveModule3Data(data: Partial<Omit<Module3Data, 'timestamp'>>): void {
  const existing = getModule3Data()

  const mergedPerspectives = data.perspectives ?? existing?.perspectives ?? []
  const mergedFinalOutput = data.finalOutput ?? existing?.finalOutput ?? null
  const mergedInputHash = data.inputHash ?? existing?.inputHash ?? ""
  const mergedAutoAdvanceConsumed = data.autoAdvanceConsumed ?? existing?.autoAdvanceConsumed ?? false
  const mergedLastStep = data.lastStep ?? existing?.lastStep ?? 0
  const mergedFirstViewConsumed = data.firstViewConsumed ?? existing?.firstViewConsumed ?? false

  // Avoid creating empty records when no historical data and no new data provided
  if (!existing && mergedPerspectives.length === 0 && !mergedFinalOutput) {
    return
  }

  updateSession({
    module3: {
      perspectives: mergedPerspectives,
      finalOutput: mergedFinalOutput,
      inputHash: mergedInputHash,
      autoAdvanceConsumed: mergedAutoAdvanceConsumed,
      lastStep: mergedLastStep,
      firstViewConsumed: mergedFirstViewConsumed,
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
 * Save Module 4 data
 */
export function saveModule4Data(data: {
  debateResult: DebateResult | null
  enrichmentResult?: EnrichmentResult | null
  enrichmentEnabled?: boolean
}): void {
  const previous = getModule4Data()
  const preference = data.enrichmentEnabled ?? previous?.enrichmentEnabled ?? true
  updateSession({
    module4: {
      debateResult: data.debateResult,
      enrichmentResult: data.enrichmentResult ?? null,
      enrichmentEnabled: preference,
      timestamp: Date.now()
    },
    currentModule: 4
  })
}

/**
 * Get Module 4 data
 */
export function getModule4Data(): Module4Data | null {
  const session = getSession()
  return session?.module4 || null
}

/**
 * Clear Module 4 data
 */
export function clearModule4Data(): void {
  updateSession({ module4: undefined })
}

/**
 * Save final analysis summary
 */
export function saveFinalAnalysis(data: Omit<FinalAnalysisData, 'timestamp'>): void {
  updateSession({
    finalAnalysis: {
      ...data,
      timestamp: Date.now()
    },
    pipelineCompleted: true,
    currentModule: 5
  })
}

/**
 * Get final analysis summary
 */
export function getFinalAnalysisData(): FinalAnalysisData | null {
  const session = getSession()
  return session?.finalAnalysis || null
}

/**
 * Clear final analysis summary
 */
export function clearFinalAnalysisData(): void {
  updateSession({ finalAnalysis: undefined, pipelineCompleted: false })
}

/**
 * Flag pipeline completion status
 */
export function setPipelineCompleted(isCompleted: boolean): void {
  updateSession({ pipelineCompleted: isCompleted })
}

/**
 * Check pipeline completion status
 */
export function isPipelineCompleted(): boolean {
  const session = getSession()
  return session?.pipelineCompleted === true
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
  } catch (error: unknown) {
    console.error('[Session] Error clearing session:', error)
  }
}

/**
 * Clear ALL data - session + all module-specific caches + backend files
 * Use this for "New Session" functionality
 */
export async function clearAllData(): Promise<void> {
  try {
    const existingSession = getSession()
    const existingSessionId = existingSession?.sessionId ?? null

    // Clear main session
    localStorage.removeItem(SESSION_KEY)

    // Clear Module 3 perspective cache
    localStorage.removeItem('module3_perspective_cache')
    
    // Clear Module 4 debate cache
    localStorage.removeItem('module4_debate_cache')
    
    console.log('[Session] Frontend cache cleared')
    
    // Clear backend data
    if (existingSessionId) {
      const encodedId = encodeURIComponent(existingSessionId)

      try {
        await fetch(`/module3/api/clear?session_id=${encodedId}`, { method: 'POST' })
        console.log('[Session] Module 3 backend cleared')
      } catch (err: unknown) {
        console.warn('[Session] Failed to clear Module 3 backend:', err)
      }

      try {
        await fetch(`/module4/api/clear?session_id=${encodedId}`, { method: 'POST' })
        console.log('[Session] Module 4 backend cleared')
      } catch (err: unknown) {
        console.warn('[Session] Failed to clear Module 4 backend:', err)
      }
    }
    
    console.log('[Session] All data cleared - ready for new session')
  } catch (error: unknown) {
    console.error('[Session] Error clearing all data:', error)
  }
}

/**
 * Check if session has module data
 */
export function hasModuleData(moduleNumber: 1 | 2 | 3 | 4): boolean {
  const session = getSession()
  if (!session) return false

  switch (moduleNumber) {
    case 1:
      return !!session.module1
    case 2:
      return !!session.module2
    case 3:
      return !!session.module3
    case 4:
      return !!session.module4
    default:
      return false
  }
}

/**
 * Get session progress (which modules have data)
 */
export function getSessionProgress(): {
  module1: boolean
  module2: boolean
  module3: boolean
  module4: boolean
  finalAnalysis: boolean
  pipelineCompleted: boolean
} {
  return {
    module1: hasModuleData(1),
    module2: hasModuleData(2),
    module3: hasModuleData(3),
    module4: hasModuleData(4),
    finalAnalysis: getFinalAnalysisData() !== null,
    pipelineCompleted: isPipelineCompleted()
  }
}
