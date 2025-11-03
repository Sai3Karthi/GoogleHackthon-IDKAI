import dynamic from 'next/dynamic'

// Dynamic import with SSR disabled to prevent hydration issues
const Module4Client = dynamic(() => import('./module-4-client').then(mod => ({ default: mod.Module4Client })), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="flex items-center gap-3">
        <div className="w-4 h-4 border-2 border-white/20 border-t-white animate-spin rounded-full"></div>
        <span className="text-white/60">Loading Module 4...</span>
      </div>
    </div>
  )
})

export function Module4() {
  return <Module4Client />

}



