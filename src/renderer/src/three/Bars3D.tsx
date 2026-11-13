import { useRef, type ReactNode } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'

function Bar({ x, h, highlight }: { x: number; h: number; highlight: boolean }) {
  const ref = useRef<THREE.Mesh>(null)
  const target = Math.max(0.06, h)
  useFrame((_, dt) => {
    const m = ref.current
    if (!m) return
    m.scale.y = THREE.MathUtils.lerp(m.scale.y, target, Math.min(1, dt * 4))
    m.position.y = m.scale.y / 2
  })
  return (
    <mesh ref={ref} position={[x, 0, 0]} scale={[1, 0.01, 1]}>
      <boxGeometry args={[0.55, 1, 0.55]} />
      <meshStandardMaterial
        color={highlight ? '#25d366' : '#38bdf8'}
        emissive={highlight ? '#25d366' : '#0ea5e9'}
        emissiveIntensity={0.55}
        metalness={0.3}
        roughness={0.25}
        transparent
        opacity={0.92}
      />
    </mesh>
  )
}

function Rig({ children }: { children: ReactNode }) {
  const ref = useRef<THREE.Group>(null)
  useFrame((state) => {
    if (!ref.current) return
    ref.current.rotation.y = THREE.MathUtils.lerp(ref.current.rotation.y, -0.35 + state.pointer.x * 0.25, 0.05)
  })
  return <group ref={ref}>{children}</group>
}

/** Gráfico de barras 3D dos envios dos últimos 7 dias. */
export default function Bars3D({ values }: { values: number[] }) {
  const max = Math.max(1, ...values)
  const n = values.length
  return (
    <Canvas camera={{ position: [0, 2.2, 5.2], fov: 40 }} dpr={[1, 1.75]} gl={{ alpha: true, antialias: true }}>
      <ambientLight intensity={0.5} />
      <pointLight position={[3, 5, 4]} intensity={60} color="#a5f3fc" />
      <pointLight position={[-4, 2, -2]} intensity={25} color="#25d366" />
      <Rig>
        <group position={[0, -1, 0]}>
          <RoundedBox args={[n * 0.85 + 0.6, 0.12, 1.4]} radius={0.05} position={[0, -0.06, 0]}>
            <meshStandardMaterial color="#0b1730" metalness={0.6} roughness={0.35} />
          </RoundedBox>
          {values.map((v, i) => (
            <Bar key={i} x={(i - (n - 1) / 2) * 0.85} h={(v / max) * 2.6} highlight={i === n - 1} />
          ))}
        </group>
      </Rig>
    </Canvas>
  )
}
