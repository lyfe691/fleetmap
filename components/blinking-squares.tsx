"use client"

import React, { useEffect, useMemo, useRef } from "react"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"
import { cn } from "@/lib/utils"

export type BlinkingSquaresDirection = "right" | "left" | "top" | "bottom"

export interface BlinkingSquaresProps {
  /** Container width */
  width?: string | number
  /** Container height */
  height?: string | number
  /** Additional CSS classes */
  className?: string
  /** Content rendered above the field */
  children?: React.ReactNode
  /**
   * Edge the dense, large squares are anchored to. The grid fades to
   * empty in the opposite direction.
   */
  direction?: BlinkingSquaresDirection
  /** Number of grid cells along the long axis (8–200) */
  gridSize?: number
  /** Square color (hex) */
  squareColor?: string
  /**
   * Sharpness of the curve between `fadeStart` and `fadeEnd`. 1 =
   * linear, higher = stays empty longer then ramps fast (0.3–6).
   */
  falloff?: number
  /**
   * Where the field first starts becoming non-empty along `direction`,
   * 0..1 (empty edge = 0, dense edge = 1). Anything before this is
   * pure background. Default 0.05.
   */
  fadeStart?: number
  /**
   * Where the field reaches full density along `direction`, 0..1.
   * Must be greater than `fadeStart`. Default 1.
   */
  fadeEnd?: number
  /**
   * Constant square fill % within each cell (0–1). Squares are uniform
   * size; density is the only thing that varies along the gradient.
   */
  squareSize?: number
  /**
   * Min brightness of a lit cell (0–1). Lit cells are randomly mapped
   * between this and 1.0 so the dense field has tonal variation.
   */
  minBrightness?: number
  /** Per-cell twinkle rate in cycles/second (0–4) */
  twinkleSpeed?: number
  /** Strength of the per-cell brightness oscillation (0–1) */
  twinkleStrength?: number
  /** Master brightness multiplier (0–2) */
  intensity?: number
  /** Master alpha (0–1) */
  opacity?: number
  /** Maximum device pixel ratio (1–3) */
  dpr?: number
}

const squaresVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const squaresFragment = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform vec2  uRes;
uniform float uTime;
uniform float uGrid;
uniform vec2  uDir;
uniform float uFalloff;
uniform float uFadeStart;
uniform float uFadeEnd;
uniform float uSquareSize;
uniform float uMinBright;
uniform float uTwinkleSpeed;
uniform float uTwinkleStrength;
uniform float uIntensity;
uniform float uAlpha;
uniform vec3  uSquare;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 cellsXY = vec2(uGrid * aspect, uGrid);
  if (aspect < 1.0) cellsXY = vec2(uGrid, uGrid / max(aspect, 0.0001));

  vec2 gridUv = vUv * cellsXY;
  vec2 cellId = floor(gridUv);
  vec2 cellUv = fract(gridUv) - 0.5;

  vec2 cellCenter = (cellId + 0.5) / cellsXY;
  vec2 centered = cellCenter * 2.0 - 1.0;
  float t = clamp(dot(centered, uDir) * 0.5 + 0.5, 0.0, 1.0);

  float fs = clamp(uFadeStart, 0.0, 0.999);
  float fe = clamp(uFadeEnd, fs + 0.001, 1.0);
  float remap = clamp((t - fs) / (fe - fs), 0.0, 1.0);
  float density = pow(remap, max(uFalloff, 0.0001));

  float gate = hash21(cellId + 11.7);
  float bRnd = hash21(cellId + 47.3);
  float pRnd = hash21(cellId + 91.1);

  float lit = step(gate, density);

  float half_ = clamp(uSquareSize, 0.05, 0.98) * 0.5;
  float inside = step(abs(cellUv.x), half_) * step(abs(cellUv.y), half_);

  float baseBright = mix(clamp(uMinBright, 0.0, 1.0), 1.0, bRnd);

  float phase = pRnd * 6.2831853;
  float speed = uTwinkleSpeed * (0.6 + 0.8 * bRnd);
  float pulse = 0.5 + 0.5 * sin(uTime * speed + phase);
  float twinkle = mix(1.0 - uTwinkleStrength, 1.0, pulse);

  float mask = inside * lit * baseBright * twinkle * uIntensity;

  // Transparent field: squares carry alpha so it composites over whatever
  // background sits behind it (any theme). Straight (non-premultiplied) alpha
  // to match the material's default NormalBlending.
  float a = clamp(mask, 0.0, 1.0) * uAlpha;
  gl_FragColor = vec4(uSquare, a);
}
`

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!m) return [0, 0, 0]
  return [
    parseInt(m[1], 16) / 255,
    parseInt(m[2], 16) / 255,
    parseInt(m[3], 16) / 255,
  ]
}

function dirToVec(dir: BlinkingSquaresDirection): [number, number] {
  switch (dir) {
    case "left":
      return [-1, 0]
    case "top":
      return [0, 1]
    case "bottom":
      return [0, -1]
    case "right":
    default:
      return [1, 0]
  }
}

type SceneProps = Required<
  Omit<BlinkingSquaresProps, "width" | "height" | "className" | "children" | "dpr">
>

const SquaresScene: React.FC<SceneProps> = (props) => {
  const meshRef = useRef<THREE.Mesh>(null)
  const { size } = useThree()

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uGrid: { value: 80 },
      uDir: { value: new THREE.Vector2(1, 0) },
      uFalloff: { value: 1.6 },
      uFadeStart: { value: 0.05 },
      uFadeEnd: { value: 1 },
      uSquareSize: { value: 0.7 },
      uMinBright: { value: 0.25 },
      uTwinkleSpeed: { value: 1.4 },
      uTwinkleStrength: { value: 0.7 },
      uIntensity: { value: 1 },
      uAlpha: { value: 1 },
      uSquare: { value: new THREE.Vector3(0.32, 0.05, 0.85) },
    }),
    []
  )

  // Prop-derived uniforms are constant between frames — set them when the props
  // change rather than re-parsing hex/dir on every rAF tick. (uniforms is the
  // same object the material holds, reached via the mesh ref.)
  useEffect(() => {
    const u = (meshRef.current?.material as THREE.ShaderMaterial | undefined)
      ?.uniforms
    if (!u) return
    u.uGrid.value = Math.max(4, Math.min(400, props.gridSize))
    const [dx, dy] = dirToVec(props.direction)
    u.uDir.value.set(dx, dy)
    u.uFalloff.value = props.falloff
    u.uFadeStart.value = props.fadeStart
    u.uFadeEnd.value = props.fadeEnd
    u.uSquareSize.value = props.squareSize
    u.uMinBright.value = props.minBrightness
    u.uTwinkleSpeed.value = props.twinkleSpeed
    u.uTwinkleStrength.value = props.twinkleStrength
    u.uIntensity.value = props.intensity
    u.uAlpha.value = props.opacity
    const [sr, sg, sb] = hexToRgb(props.squareColor)
    u.uSquare.value.set(sr, sg, sb)
  }, [
    props.gridSize,
    props.direction,
    props.falloff,
    props.fadeStart,
    props.fadeEnd,
    props.squareSize,
    props.minBrightness,
    props.twinkleSpeed,
    props.twinkleStrength,
    props.intensity,
    props.opacity,
    props.squareColor,
  ])

  // Only the clock and viewport size change per frame.
  useFrame((state) => {
    if (!meshRef.current) return
    const u = (meshRef.current.material as THREE.ShaderMaterial).uniforms
    u.uTime.value = state.clock.elapsedTime
    u.uRes.value.set(size.width, size.height)
  })

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        vertexShader={squaresVertex}
        fragmentShader={squaresFragment}
        uniforms={uniforms}
        transparent
      />
    </mesh>
  )
}

const BlinkingSquares: React.FC<BlinkingSquaresProps> = ({
  width = "100%",
  height = "100%",
  className,
  children,
  direction = "right",
  gridSize = 52,
  squareColor = "#BB29FF",
  falloff = 1.25,
  fadeStart = 0.65,
  fadeEnd = 1,
  squareSize = 0.57,
  minBrightness = 0.55,
  twinkleSpeed = 1.4,
  twinkleStrength = 0.94,
  intensity = 1,
  opacity = 1,
  dpr = 1.5,
}) => {
  return (
    <div
      className={cn("relative overflow-hidden", className)}
      style={{ width, height }}
    >
      <Canvas
        className="absolute inset-0"
        dpr={[1, dpr]}
        gl={{
          antialias: false,
          alpha: true,
          powerPreference: "high-performance",
        }}
        orthographic
        camera={{
          position: [0, 0, 1],
          zoom: 1,
          left: -1,
          right: 1,
          top: 1,
          bottom: -1,
        }}
      >
        <SquaresScene
          direction={direction}
          gridSize={gridSize}
          squareColor={squareColor}
          falloff={falloff}
          fadeStart={fadeStart}
          fadeEnd={fadeEnd}
          squareSize={squareSize}
          minBrightness={minBrightness}
          twinkleSpeed={twinkleSpeed}
          twinkleStrength={twinkleStrength}
          intensity={intensity}
          opacity={opacity}
        />
      </Canvas>
      {children && <div className="relative z-10">{children}</div>}
    </div>
  )
}

BlinkingSquares.displayName = "BlinkingSquares"

export default BlinkingSquares
