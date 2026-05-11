interface OptimizingIndicatorProps {
  visible: boolean
}

export function OptimizingIndicator({ visible }: OptimizingIndicatorProps) {
  return (
    <div className={`aura-3d-optimizing${visible ? '' : ' aura-3d-optimizing--hidden'}`}>
      <span className="aura-3d-optimizing__dot" />
      Optimizing layout...
    </div>
  )
}