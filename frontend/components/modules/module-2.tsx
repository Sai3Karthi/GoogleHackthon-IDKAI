"use client"

import { ModuleLayout } from "./module-layout"

export function Module2() {
  return (
    <ModuleLayout
      moduleNumber={2}
      title="Information Classification"
      description="Classify information and assign significance scores"
      status="progress"
    >
      <div className="space-y-12">
        {/* Overview */}
        <div className="border border-white/10 rounded p-8">
          <h2 className="text-base font-light text-white/70 mb-6 tracking-wide">Overview</h2>
          <p className="text-white/60 leading-relaxed">
            This module intelligently classifies incoming information and assigns a significance 
            score that determines the depth and thoroughness of analysis in subsequent modules.
          </p>
        </div>

        {/* Status */}
        <div className="border border-white/10 rounded p-8">
          <h3 className="text-base font-light text-white/70 mb-6 tracking-wide">Development Status</h3>
          <div className="space-y-3">
            <div className="text-white/60 text-sm">
              Machine learning models for intelligent classification and scoring are currently being trained and optimized.
            </div>
          </div>
        </div>

        {/* Scoring System */}
        <div className="border border-white/10 rounded p-8">
          <h3 className="text-base font-light text-white/70 mb-6 tracking-wide">Scoring Methodology</h3>
          <div className="space-y-4">
            <div>
              <div className="text-xs text-white/40 mb-2">Significance Score Range</div>
              <div className="text-white/60 text-sm">0.0 - 1.0</div>
            </div>
            <div>
              <div className="text-xs text-white/40 mb-2">Determines</div>
              <div className="text-white/60 text-sm">
                Depth of perspective generation and analysis intensity in Module 3
              </div>
            </div>
          </div>
        </div>
      </div>
    </ModuleLayout>
  )
}



