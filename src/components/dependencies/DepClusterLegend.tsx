import type { Cluster } from '../../hooks/useDependencies'

interface DepClusterLegendProps {
  clusters: Cluster[]
  activeFilter: string | null
  onClusterClick: (cluster: string | null) => void
}

export function DepClusterLegend({ clusters, activeFilter, onClusterClick }: DepClusterLegendProps) {
  return (
    <div className="dep-cluster-legend">
      <span className="dep-cluster-legend__label">Clusters:</span>
      <button
        className={`dep-cluster-legend__item${!activeFilter ? ' dep-cluster-legend__item--active' : ''}`}
        onClick={() => onClusterClick(null)}
      >
        <span className="dep-cluster-legend__dot" style={{ background: 'var(--text-tertiary)' }} />
        All
      </button>
      {clusters.map((cluster) => (
        <button
          key={cluster.name}
          className={`dep-cluster-legend__item${activeFilter === cluster.name ? ' dep-cluster-legend__item--active' : ''}`}
          onClick={() => onClusterClick(cluster.name)}
        >
          <span className="dep-cluster-legend__dot" style={{ background: cluster.color }} />
          {cluster.name}
        </button>
      ))}
    </div>
  )
}