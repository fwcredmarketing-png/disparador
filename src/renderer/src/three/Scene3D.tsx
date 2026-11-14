import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Stars } from '@react-three/drei'
import * as THREE from 'three'

const RADIUS = 2

function fibonacciSphere(n: number, r: number): Float32Array {
  const arr = new Float32Array(n * 3)
  const phi = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2
    const rad = Math.sqrt(1 - y * y)
    const th = phi * i
    arr[i * 3] = Math.cos(th) * rad * r
    arr[i * 3 + 1] = y * r
    arr[i * 3 + 2] = Math.sin(th) * rad * r
  }
  return arr
}

const randomOnSphere = (r: number) => new THREE.Vector3().randomDirection().multiplyScalar(r)

interface Pulse {
  line: THREE.Line
  head: THREE.Mesh
  curve: THREE.QuadraticBezierCurve3
  t: number
  speed: number
}

/** Arcos luminosos que "viajam" pelo globo a cada mensagem enviada. */
function Pulses({ signal, idle, color }: { signal: number; idle: boolean; color: string }) {
  const pool = useMemo<Pulse[]>(() => {
    return Array.from({ length: 28 }, () => {
      const geo = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 48 }, () => new THREE.Vector3()))
      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending })
      )
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 12, 12),
        new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0 })
      )
      return { line, head, curve: new THREE.QuadraticBezierCurve3(), t: 1, speed: 0.6 }
    })
  }, [color])

  const fire = () => {
    const p = pool.find((x) => x.t >= 1)
    if (!p) return
    const a = randomOnSphere(RADIUS)
    const b = randomOnSphere(RADIUS)
    const mid = a.clone().add(b).multiplyScalar(0.5)
    const lift = RADIUS + 0.6 + a.distanceTo(b) * 0.45
    mid.setLength(lift)
    p.curve = new THREE.QuadraticBezierCurve3(a, mid, b)
    p.line.geometry.setFromPoints(p.curve.getPoints(47))
    p.t = 0
    p.speed = 0.45 + Math.random() * 0.35
  }

  useEffect(() => {
    if (signal > 0) for (let i = 0; i < 3; i++) setTimeout(fire, i * 90)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal])

  const idleTimer = useRef(0)
  useFrame((_, dt) => {
    idleTimer.current += dt
    if (idle && idleTimer.current > 1.6) {
      idleTimer.current = 0
      fire()
    }
    for (const p of pool) {
      const lm = p.line.material as THREE.LineBasicMaterial
      const hm = p.head.material as THREE.MeshBasicMaterial
      if (p.t >= 1) {
        lm.opacity = Math.max(0, lm.opacity - dt * 1.5)
        hm.opacity = 0
        continue
      }
      p.t = Math.min(1, p.t + dt * p.speed)
      p.head.position.copy(p.curve.getPoint(p.t))
      hm.opacity = 1 - p.t * 0.3
      lm.opacity = Math.sin(p.t * Math.PI) * 0.9
    }
  })

  return (
    <group>
      {pool.map((p, i) => (
        <group key={i}>
          <primitive object={p.line} />
          <primitive object={p.head} />
        </group>
      ))}
    </group>
  )
}

function Ring({ radius, tilt, speed, color }: { radius: number; tilt: number; speed: number; color: string }) {
  const ref = useRef<THREE.Group>(null)
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * speed
  })
  return (
    <group rotation={[tilt, 0, tilt / 2]}>
      <group ref={ref}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[radius, 0.006, 8, 160]} />
          <meshBasicMaterial color={color} transparent opacity={0.35} />
        </mesh>
        <mesh position={[radius, 0, 0]}>
          <sphereGeometry args={[0.06, 16, 16]} />
          <meshBasicMaterial color={color} />
        </mesh>
      </group>
    </group>
  )
}

function Globe({ color, signal, idle }: { color: string; signal: number; idle: boolean }) {
  const group = useRef<THREE.Group>(null)
  const positions = useMemo(() => fibonacciSphere(2200, RADIUS), [])
  useFrame((state, dt) => {
    if (!group.current) return
    group.current.rotation.y += dt * 0.07
    // leve parallax com o mouse
    const { x, y } = state.pointer
    group.current.rotation.x = THREE.MathUtils.lerp(group.current.rotation.x, -y * 0.25, 0.04)
    state.camera.position.x = THREE.MathUtils.lerp(state.camera.position.x, x * 0.5, 0.03)
    state.camera.lookAt(1.6, 0, 0)
  })
  return (
    <group position={[2.4, -0.1, 0]}>
      <group ref={group}>
        <points>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          </bufferGeometry>
          <pointsMaterial size={0.03} color={color} transparent opacity={0.85} sizeAttenuation depthWrite={false} />
        </points>
        <mesh>
          <sphereGeometry args={[RADIUS * 0.985, 64, 64]} />
          <meshBasicMaterial color="#020a18" transparent opacity={0.9} />
        </mesh>
        <mesh>
          <icosahedronGeometry args={[RADIUS * 1.12, 3]} />
          <meshBasicMaterial color={color} wireframe transparent opacity={0.05} />
        </mesh>
        <Pulses signal={signal} idle={idle} color={color} />
      </group>
      <Ring radius={2.9} tilt={0.5} speed={0.25} color="#38bdf8" />
      <Ring radius={3.3} tilt={-0.35} speed={-0.18} color={color} />
      <mesh>
        <sphereGeometry args={[RADIUS * 1.35, 32, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.035} side={THREE.BackSide} />
      </mesh>
    </group>
  )
}

export type Fx = 'completo' | 'leve' | 'desligado'

/**
 * Perfis de desempenho. Em telas grandes (2K/4K) desenhar o 3D a 60 quadros por
 * segundo em resolução cheia ocupa mais de um núcleo do processador o tempo todo.
 */
const PERFIS: Record<Fx, { fps: number; dpr: number | [number, number]; antialias: boolean; stars: number }> = {
  completo: { fps: 60, dpr: [1, 1.5], antialias: true, stars: 2500 },
  leve: { fps: 30, dpr: 1, antialias: false, stars: 1200 },
  desligado: { fps: 0, dpr: 1, antialias: false, stars: 1200 } // desenha só quando algo muda
}

/** Limita os quadros por segundo (com frameloop="demand"). */
export function Limitador({ fps }: { fps: number }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    const t = setInterval(() => invalidate(), 1000 / fps)
    return () => clearInterval(t)
  }, [fps, invalidate])
  return null
}

/** Cena 3D de fundo: globo de pontos que reage ao status e aos envios. */
export default function Scene3D({ connected, signal, fx }: { connected: boolean; signal: number; fx: Fx }) {
  const color = connected ? '#25d366' : '#f97373'
  const p = PERFIS[fx]
  return (
    <div className="scene3d">
      <Canvas
        key={fx} // antialias só muda recriando o contexto
        camera={{ position: [0, 0, 7.5], fov: 50 }}
        dpr={p.dpr}
        frameloop={p.fps >= 60 ? 'always' : 'demand'}
        gl={{ antialias: p.antialias, alpha: true, powerPreference: 'low-power' }}
      >
        {p.fps > 0 && p.fps < 60 && <Limitador fps={p.fps} />}
        <fog attach="fog" args={['#050814', 6, 16]} />
        <Stars radius={60} depth={40} count={p.stars} factor={3} saturation={0} fade speed={0.6} />
        <Globe color={color} signal={signal} idle={connected} />
      </Canvas>
    </div>
  )
}
