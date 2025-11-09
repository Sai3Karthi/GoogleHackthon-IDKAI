export type ModuleAnalysisMode = "text" | "image"

export interface AnalysisDetails {
  red_flags?: string[]
  ai_explanation?: string
  ai_reasoning?: string
  scam_keywords_found?: number
  phishing_patterns_found?: number
  text_length?: number
  visual_elements?: string[]
  extracted_text?: string
}

export interface ScrapedContent {
  title: string
  text: string
}

export interface ImageInfo {
  format: string
  size_kb: number
  dimensions: [number, number]
  source: string
}

export interface AnalysisResult {
  session_id: string
  input_type: string
  risk_level: string
  confidence: number
  threats: string[]
  analysis: AnalysisDetails
  recommendation: string
  scraped_content?: ScrapedContent | null
  ai_powered: boolean
  image_info?: ImageInfo
  skip_to_final?: boolean
  skip_reason?: string
}

export interface ClassificationResult {
  person: number
  organization: number
  social: number
  critical: number
  stem: number
}

export interface DetailedAnalysis {
  classification: ClassificationResult
  classification_reasoning: string
  classification_confidence: number
  significance_score: number
  significance_explanation: string
  comprehensive_summary: string
  requires_debate: boolean
  debate_priority: string
}

export interface Module2Output {
  detailed_analysis: DetailedAnalysis
  module1_confidence: number
  module1_risk_level: string
  module1_threats: string[]
  timestamp: string
}

export interface Module3InputMetadata {
  topic?: string
  text?: string
  summary?: string
  significance_score?: number
  [key: string]: unknown
}

export interface Perspective {
  color: string
  bias_x: number
  significance_y: number
  text: string
  [key: string]: unknown
}

export interface PerspectiveClusters {
  leftist: Perspective[]
  rightist: Perspective[]
  common: Perspective[]
}

export interface Module3CachePayload {
  perspectives: Perspective[]
  finalOutput: PerspectiveClusters
  timestamp: number
  inputHash: string
}

export interface DebateMessage {
  agent: string
  agent_type?: string
  message?: string
  argument?: string
  round?: number
}

export interface DebateVerdict {
  trust_score?: number
  reasoning?: string
  message?: string
  recommendation?: string
}

export interface DebateResult {
  status: string
  message: string
  trust_score?: number
  judgment?: string
  debate_file?: string
  debate_transcript?: DebateMessage[]
  topic?: string
  final_verdict?: DebateVerdict
}

export interface EnrichmentFiles {
  leftist?: string
  rightist?: string
  common?: string
}

export interface EnrichmentSummaryEntry {
  total_items: number
  items_with_links: number
}

export interface EnrichmentResult {
  status: string
  message: string
  enriched_files?: EnrichmentFiles
  total_links_found?: number
  total_relevant_links?: number
  summary?: Record<string, EnrichmentSummaryEntry>
}

export interface EnrichmentItem {
  category: string
  perspective_text: string
  url: string
  title: string
  trust_score: number
  source_type: string
  extracted_text: string
}
