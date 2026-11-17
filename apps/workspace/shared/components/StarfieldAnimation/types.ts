export interface StarfieldAnimationProps {
  particleCount?: number
  maxRadius?: number
  particleSize?: number
  rotationSpeed?: number
  seed?: number
  particleColor?: string
  className?: string
}

export interface Particle {
  angle: number
  radius: number
  size: number
  opacity: number
}
