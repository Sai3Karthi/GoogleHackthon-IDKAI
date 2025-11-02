"use client"

import { Suspense } from "react"
import { Module5 } from "@/components/modules"

function Module5PageContent() {
  return <Module5 />
}

export default function Module5Page() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-white/60">Loading...</div>
      </div>
    }>
      <Module5PageContent />
    </Suspense>
  )
}
