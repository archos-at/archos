'use client'

import { type FC, useRef, useEffect, useCallback } from 'react'

import type { StarfieldAnimationProps, Particle } from './types'
import { SeededRandom } from './utils'

const DEFAULT_PARTICLE_COUNT = 250
const DEFAULT_MAX_RADIUS = 50
const DEFAULT_PARTICLE_SIZE = 2.0
const DEFAULT_ROTATION_SPEED = 0.001
const DEFAULT_SEED = 12345
const DEFAULT_PARTICLE_COLOR = 'var(--primary)'

export const StarfieldAnimation: FC<StarfieldAnimationProps> = ({
  particleCount = DEFAULT_PARTICLE_COUNT,
  maxRadius = DEFAULT_MAX_RADIUS,
  particleSize = DEFAULT_PARTICLE_SIZE,
  rotationSpeed = DEFAULT_ROTATION_SPEED,
  seed = DEFAULT_SEED,
  particleColor = DEFAULT_PARTICLE_COLOR,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationFrameRef = useRef<number>(0)
  const rotationRef = useRef<number>(0)
  const particlesRef = useRef<Particle[]>([])

  const createParticles = useCallback((): Particle[] => {
    const rng = new SeededRandom(seed)
    const particles: Particle[] = []

    for (let i = 0; i < particleCount; i++) {
      const angle = rng.next() * Math.PI * 2
      const distribution = rng.next()

      let radius: number
      if (distribution < 0.7) {
        radius = maxRadius * (0.8 + rng.next() * 0.2)
      } else if (distribution < 0.95) {
        radius = maxRadius * (0.4 + rng.next() * 0.4)
      } else {
        radius = maxRadius * (0.15 + rng.next() * 0.25)
      }

      const size =
        (distribution < 0.95
          ? rng.next() * 0.7 + 0.3
          : rng.next() * 1.2 + 0.7) * particleSize

      const opacity =
        distribution < 0.6
          ? 0.95 + rng.next() * 0.05
          : 0.6 + rng.next() * 0.35

      particles.push({ angle, radius, size, opacity })
    }

    return particles
  }, [particleCount, maxRadius, particleSize, seed])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resolvedColor =
      typeof window !== 'undefined' && particleColor.startsWith('var(')
        ? getComputedStyle(document.documentElement).getPropertyValue(particleColor.slice(4, -1)).trim() || particleColor
        : particleColor

    const updateCanvasSize = (): { width: number; height: number; scale: number } => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const width = rect.width * dpr
      const height = rect.height * dpr

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }

      return { width, height, scale: dpr }
    }

    updateCanvasSize()

    particlesRef.current = createParticles()

    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')

    const drawFrame = (advanceRotation: boolean): void => {
      const { width, height, scale: currentScale } = updateCanvasSize()

      ctx.clearRect(0, 0, width, height)
      if (advanceRotation) rotationRef.current += rotationSpeed

      const particles = particlesRef.current
      const rotation = rotationRef.current

      const centerX = width / 2
      const centerY = height / 2

      const scaleFactor = currentScale

      ctx.fillStyle = resolvedColor

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]
        const x = centerX + Math.cos(p.angle + rotation) * p.radius * scaleFactor
        const y = centerY + Math.sin(p.angle + rotation) * p.radius * scaleFactor
        const size = p.size * scaleFactor * 1.5 // Scale up slightly for triangles

        ctx.globalAlpha = p.opacity
        ctx.beginPath()

        const triangleRotation = p.angle + rotation
        const cos0 = Math.cos(triangleRotation - Math.PI / 2)
        const sin0 = Math.sin(triangleRotation - Math.PI / 2)
        const cos1 = Math.cos(triangleRotation + Math.PI / 6)
        const sin1 = Math.sin(triangleRotation + Math.PI / 6)
        const cos2 = Math.cos(triangleRotation + (5 * Math.PI) / 6)
        const sin2 = Math.sin(triangleRotation + (5 * Math.PI) / 6)

        ctx.moveTo(x + cos0 * size, y + sin0 * size)
        ctx.lineTo(x + cos1 * size, y + sin1 * size)
        ctx.lineTo(x + cos2 * size, y + sin2 * size)
        ctx.closePath()
        ctx.fill()
      }

      ctx.globalAlpha = 1
    }

    const animate = (): void => {
      drawFrame(true)
      animationFrameRef.current = requestAnimationFrame(animate)
    }

    const start = (): void => {
      cancelAnimationFrame(animationFrameRef.current)
      if (reducedMotionQuery.matches) {
        drawFrame(false)
      } else {
        animationFrameRef.current = requestAnimationFrame(animate)
      }
    }

    start()
    reducedMotionQuery.addEventListener('change', start)

    return () => {
      reducedMotionQuery.removeEventListener('change', start)
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [createParticles, rotationSpeed, particleColor])

  return (
    <canvas
      ref={canvasRef}
      className={['block', 'h-full', 'w-full', className].filter(Boolean).join(' ')}
      aria-hidden="true"
    />
  )
}
