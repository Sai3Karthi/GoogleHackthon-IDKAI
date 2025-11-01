"use client"

import { ModuleLayout } from "./module-layout"

export function Module4() {
  return (
    <ModuleLayout
      moduleNumber={4}
      title="Agent Debate & Analysis"
      description="Two agents debate perspectives to analyze the overall standing of information"
      status="progress"
    >
      <div className="space-y-12">
        {/* Overview */}
        <div className="border border-white/10 rounded p-8">
          <h2 className="text-base font-light text-white/70 mb-6 tracking-wide">Overview</h2>
          <p className="text-white/60 leading-relaxed">
            This module receives the categorized perspectives from Module 3 and uses two sophisticated 
            AI agents to engage in structured debate, analyzing the overall standing of the information.
          </p>
        </div>

        {/* Core Principle */}
        <div className="border border-white/10 rounded p-8">
          <h3 className="text-base font-light text-white/70 mb-6 tracking-wide">Core Principle</h3>
          <div className="text-white/60 text-sm leading-relaxed">
            <p className="mb-4">
              <span className="text-white">"AI can never be sure if information is true, only humans can."</span>
            </p>
            <p>
              Therefore, we make the AI as sophisticated as possible to provide comprehensive analysis 
              that empowers human decision-making.
            </p>
          </div>
        </div>

        {/* Agent System */}
        <div className="border border-white/10 rounded p-8">
          <h3 className="text-base font-light text-white/70 mb-6 tracking-wide">Agent Architecture</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-5 border border-white/10 rounded">
              <div className="text-xs text-white/40 mb-2">Leftist Agent</div>
              <div className="text-white/60 text-sm">Analyzes progressive perspectives</div>
            </div>
            <div className="p-5 border border-white/10 rounded">
              <div className="text-xs text-white/40 mb-2">Rightist Agent</div>
              <div className="text-white/60 text-sm">Analyzes conservative perspectives</div>
            </div>
          </div>
          <div className="mt-4 p-5 border border-white/10 rounded">
            <div className="text-xs text-white/40 mb-2">Common Ground</div>
            <div className="text-white/60 text-sm">Both agents analyze shared perspectives to avoid debate folly</div>
          </div>
        </div>

        {/* Status */}
        <div className="border border-white/10 rounded p-8">
          <h3 className="text-base font-light text-white/70 mb-6 tracking-wide">Development Status</h3>
          <div className="text-white/60 text-sm">
            Advanced debate protocols and analysis algorithms are currently being fine-tuned for optimal performance.
          </div>
        </div>
      </div>
    </ModuleLayout>
  )
}



