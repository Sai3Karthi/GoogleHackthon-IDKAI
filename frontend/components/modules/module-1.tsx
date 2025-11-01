"use client"

import { ModuleLayout } from "./module-layout"

export function Module1() {
  return (
    <ModuleLayout
      moduleNumber={1}
      title="Link/Text Verification"
      description="Scam and fraud detection system for links and text content"
      status="progress"
    >
      <div className="space-y-12">
        {/* Overview */}
        <div className="border border-white/10 rounded p-8">
          <h2 className="text-base font-light text-white/70 mb-6 tracking-wide">Overview</h2>
          <p className="text-white/60 leading-relaxed">
            This module is responsible for verifying links and text content through advanced algorithms 
            to detect potential scams, fraud, or malicious information before it reaches other modules.
          </p>
        </div>

        {/* Status */}
        <div className="border border-white/10 rounded p-8">
          <h3 className="text-base font-light text-white/70 mb-6 tracking-wide">Development Status</h3>
          <div className="space-y-3">
            <div className="text-white/60 text-sm">
              Advanced verification algorithms and fraud detection systems are currently being implemented.
            </div>
          </div>
        </div>

        {/* Planned Features */}
        <div className="border border-white/10 rounded p-8">
          <h3 className="text-base font-light text-white/70 mb-6 tracking-wide">Planned Features</h3>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-1 h-1 rounded-full bg-white/40 mt-2" />
              <p className="text-white/60 text-sm">Link verification and security scanning</p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-1 h-1 rounded-full bg-white/40 mt-2" />
              <p className="text-white/60 text-sm">Deepfake detection for images and videos</p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-1 h-1 rounded-full bg-white/40 mt-2" />
              <p className="text-white/60 text-sm">Text content analysis for fraud patterns</p>
            </div>
          </div>
        </div>
      </div>
    </ModuleLayout>
  )
}



