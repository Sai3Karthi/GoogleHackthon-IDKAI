"use client";

import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";

interface Perspective {
  color: string;
  bias_x: number;
  significance_y: number;
  text: string;
}

interface ExpandablePerspectiveCardProps {
  color: string;
  perspectives: Perspective[];
  getColorClass: (color: string) => string;
  getColorName: (color: string) => string;
}

export default function ExpandablePerspectiveCard({
  color,
  perspectives,
  getColorClass,
  getColorName,
}: ExpandablePerspectiveCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [mounted, setMounted] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsExpanded(false);
    };

    if (isExpanded) {
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", handleEscape);
    } else {
      document.body.style.overflow = "auto";
    }

    return () => {
      window.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "auto";
    };
  }, [isExpanded]);

  return (
    <>
      {/* Card */}
      <div
        onClick={() => setIsExpanded(true)}
        className="h-full flex flex-col p-4 rounded-xl bg-white/5 backdrop-blur-md border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all cursor-pointer"
      >
        {/* Color Circle */}
        <div className={`w-16 h-16 mx-auto rounded-full ${getColorClass(color)} shadow-lg mb-3`} />
        
        {/* Name */}
        <div className="text-center text-sm font-light uppercase tracking-wider text-white/80 mb-2">
          {getColorName(color)}
        </div>
        
        {/* Count */}
        <div className="text-center text-xs text-white/40">
          {perspectives.length} perspectives
        </div>
        
        {/* Preview */}
        <div className="flex-1 mt-3 overflow-hidden">
          <div className="text-xs text-white/30 text-center line-clamp-3">
            {perspectives[0]?.text}
          </div>
        </div>
        
        {/* View All Button */}
        <div className="mt-3 pt-3 border-t border-white/10">
          <div className="text-xs text-center text-white/50 hover:text-white/80 transition-colors">
            Click to view all
          </div>
        </div>
      </div>

      {/* Modal */}
      {mounted && isExpanded && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/80 backdrop-blur-xl"
            onClick={() => setIsExpanded(false)}
          />

          {/* Modal Content */}
          <motion.div
            ref={modalRef}
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ duration: 0.3 }}
            className="relative w-full max-w-[700px] max-h-[90vh] flex flex-col bg-black/90 backdrop-blur-2xl border border-white/20 rounded-2xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <button
              onClick={() => setIsExpanded(false)}
              className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full transition-colors"
            >
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Header */}
            <div className={`flex-shrink-0 h-24 ${getColorClass(color).replace('bg-', 'bg-gradient-to-br from-')} to-black/50 flex items-center justify-center relative`}>
              <div className="text-white text-3xl font-light uppercase tracking-widest">
                {getColorName(color)}
              </div>
              <div className="absolute bottom-2 right-4 text-white/60 text-sm">
                {perspectives.length} perspectives
              </div>
            </div>

            {/* Content */}
            <div 
              className="flex-1 overflow-y-auto p-6"
              style={{
                scrollbarWidth: 'thin',
                scrollbarColor: 'rgba(255,255,255,0.2) transparent',
              }}
            >
              <div className="space-y-4">
                {perspectives.map((perspective, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.03, duration: 0.3 }}
                    className="p-4 bg-white/5 border border-white/10 rounded-lg"
                  >
                    <div className="flex items-center gap-3 mb-3 pb-2 border-b border-white/10">
                      <span className="text-xs text-white/40">#{index + 1}</span>
                      <div className="flex gap-4 text-xs flex-wrap">
                        <span className="text-white/50">
                          Bias: <span className="text-white/80 font-mono">{perspective.bias_x.toFixed(3)}</span>
                        </span>
                        <span className="text-white/50">
                          Significance: <span className="text-white/80 font-mono">{perspective.significance_y.toFixed(3)}</span>
                        </span>
                      </div>
                    </div>
                    <p className="text-sm text-white/70 leading-relaxed">
                      {perspective.text}
                    </p>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>,
        document.body
      )}
    </>
  );
}
