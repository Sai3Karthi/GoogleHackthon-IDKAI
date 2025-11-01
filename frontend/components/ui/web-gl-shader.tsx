"use client"

import { useEffect, useRef } from "react"
import * as THREE from "three"

// Cache shader strings outside component (they never change)
const VERTEX_SHADER = `
  attribute vec3 position;
  void main() {
    gl_Position = vec4(position, 1.0);
  }
`

const FRAGMENT_SHADER = `
  precision highp float;
  uniform vec2 resolution;
  uniform float time;
  uniform float xScale;
  uniform float yScale;
  uniform float distortion;

  void main() {
    vec2 p = (gl_FragCoord.xy * 2.0 - resolution) / min(resolution.x, resolution.y);
    
    float d = length(p) * distortion;
    
    float rx = p.x * (1.0 + d);
    float gx = p.x;
    float bx = p.x * (1.0 - d);

    float r = 0.03 / abs(p.y + sin((rx + time) * xScale) * yScale);
    float g = 0.03 / abs(p.y + sin((gx + time) * xScale) * yScale);
    float b = 0.03 / abs(p.y + sin((bx + time) * xScale) * yScale);
    
    gl_FragColor = vec4(r * 0.5, g * 0.5, b * 0.5, 1.0);
  }
`

// Cache geometry outside component (reusable)
let cachedGeometry: THREE.PlaneGeometry | null = null
const getGeometry = () => {
  if (!cachedGeometry) {
    cachedGeometry = new THREE.PlaneGeometry(2, 2, 1, 1)
  }
  return cachedGeometry
}

// Cache pixel ratio calculation
const getOptimalPixelRatio = () => Math.min(window.devicePixelRatio, 1.5)

export function WebGLShader() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<{
    scene: THREE.Scene | null
    camera: THREE.OrthographicCamera | null
    renderer: THREE.WebGLRenderer | null
    mesh: THREE.Mesh | null
    uniforms: any
    animationId: number | null
    lastFrameTime: number
    isVisible: boolean
    // Cached references for performance
    timeUniform: { value: number } | null
    rendererRef: THREE.WebGLRenderer | null
    sceneRef: THREE.Scene | null
    cameraRef: THREE.OrthographicCamera | null
  }>({
    scene: null,
    camera: null,
    renderer: null,
    mesh: null,
    uniforms: null,
    animationId: null,
    lastFrameTime: 0,
    isVisible: true,
    timeUniform: null,
    rendererRef: null,
    sceneRef: null,
    cameraRef: null,
  })

  useEffect(() => {
    if (!canvasRef.current) return

    const canvas = canvasRef.current
    const { current: refs } = sceneRef

    const initScene = () => {
      refs.scene = new THREE.Scene()
      refs.sceneRef = refs.scene // Cache scene reference

      // Optimize renderer settings for performance
      refs.renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: false,
        powerPreference: "low-power",
        precision: "mediump"
      })

      // Limit pixel ratio for better performance (cached calculation)
      refs.renderer.setPixelRatio(getOptimalPixelRatio())
      refs.renderer.setClearColor(new THREE.Color(0x000000))
      refs.renderer.setSize(window.innerWidth, window.innerHeight, false)
      refs.rendererRef = refs.renderer // Cache renderer reference

      refs.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, -1)
      refs.cameraRef = refs.camera // Cache camera reference

      refs.uniforms = {
        resolution: { value: [window.innerWidth, window.innerHeight] },
        time: { value: 0.0 },
        xScale: { value: 1.0 },
        yScale: { value: 0.5 },
        distortion: { value: 0.05 },
      }

      // Cache time uniform reference for faster access in animation loop
      refs.timeUniform = refs.uniforms.time

      // Use cached geometry
      const geometry = getGeometry()

      const material = new THREE.RawShaderMaterial({
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        uniforms: refs.uniforms,
        side: THREE.DoubleSide,
      })

      refs.mesh = new THREE.Mesh(geometry, material)
      refs.scene.add(refs.mesh)

      handleResize()
    }

    const animate = (currentTime: number) => {
      if (!refs.isVisible) {
        refs.animationId = requestAnimationFrame(animate)
        return
      }

      // Throttle to ~30fps for better performance
      if (currentTime - refs.lastFrameTime >= 33) { // ~30fps
        // Use cached time uniform reference for faster access
        if (refs.timeUniform) {
          refs.timeUniform.value += 0.01
        }
        // Use cached references for better performance
        if (refs.rendererRef && refs.sceneRef && refs.cameraRef) {
          refs.rendererRef.render(refs.sceneRef, refs.cameraRef)
        }
        refs.lastFrameTime = currentTime
      }

      refs.animationId = requestAnimationFrame(animate)
    }

    const handleResize = () => {
      if (!refs.renderer || !refs.uniforms) return
      const width = window.innerWidth
      const height = window.innerHeight
      refs.renderer.setSize(width, height, false)
      refs.uniforms.resolution.value = [width, height]
    }

    const handleVisibilityChange = () => {
      refs.isVisible = !document.hidden
    }

    initScene()
    animate(0)
    window.addEventListener("resize", handleResize, { passive: true })
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      if (refs.animationId) cancelAnimationFrame(refs.animationId)
      window.removeEventListener("resize", handleResize)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      if (refs.mesh) {
        refs.scene?.remove(refs.mesh)
        // Don't dispose cached geometry as it's shared across instances
        // Only dispose the material
        if (refs.mesh.material instanceof THREE.Material) {
          refs.mesh.material.dispose()
        }
      }
      refs.renderer?.dispose()
      // Clear cached references
      refs.rendererRef = null
      refs.sceneRef = null
      refs.cameraRef = null
      refs.timeUniform = null
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="fixed top-0 left-0 w-full h-full block"
      style={{ pointerEvents: "none" }}
    />
  )
}

