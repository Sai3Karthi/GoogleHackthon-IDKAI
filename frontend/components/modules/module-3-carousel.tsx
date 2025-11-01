"use client"

import { useState, useEffect } from "react"
import ExpandablePerspectiveCard from "@/components/ui/expandable-perspective-card"

interface Perspective {
  color: string
  bias_x: number
  significance_y: number
  text: string
}

interface CarouselProps {
  perspectives: Perspective[]
  getColorClass: (color: string) => string
  getColorName: (color: string) => string
}

const COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'indigo', 'violet']

export function PerspectiveCarousel({ perspectives, getColorClass, getColorName }: CarouselProps) {
  const [availableColors, setAvailableColors] = useState<string[]>([])

  useEffect(() => {
    const colors = COLORS.filter(color => perspectives.filter(p => p.color === color).length > 0)
    setAvailableColors(colors)
  }, [perspectives])

  return (
    <div className="w-full space-y-6">
      {/* Cards Grid */}
      <div className="grid grid-cols-7 gap-3 auto-rows-fr">
        {availableColors.map((color) => {
          const colorPerspectives = perspectives.filter(p => p.color === color)

          return (
            <div key={color} className="h-full">
              <ExpandablePerspectiveCard
                color={color}
                perspectives={colorPerspectives}
                getColorClass={getColorClass}
                getColorName={getColorName}
              />
            </div>
          )
        })}
      </div>

      {/* Navigation Dots */}
      <div className="flex justify-center gap-2">
        {availableColors.map((color) => (
          <div
            key={color}
            className={`w-2 h-2 rounded-full ${getColorClass(color)}`}
          />
        ))}
      </div>
    </div>
  )
}
