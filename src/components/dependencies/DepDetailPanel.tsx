import { useNavigate } from 'react-router-dom'
import type { DependencyNode, NodeContext } from '../../hooks/useDependencies'

interface DepDetailPanelProps {
  node: DependencyNode
  context: NodeContext | null
  projectId: string
  onNodeClick: (nodeId: string) => void
}

export function DepDetailPanel({ node, context, projectId, onNodeClick }: DepDetailPanelProps) {
  const navigate = useNavigate()

  const handleOpenInWorkspace = () => {
    navigate(`/project-mode/${projectId}?tab=workspace`, {
      state: { openFile: context?.filePath ?? node.filePath ?? node.id },
    })
  }

  return (
    <div className="dep-detail">
      <div className="dep-detail__header">
        <div className="dep-detail__color-dot" style={{ background: node.cluster ? 'var(--accent-primary)' : 'var(--text-tertiary)' }} />
        <div className="dep-detail__header-text">
          <h3 className="dep-detail__name">{node.label}</h3>
          <span className="dep-detail__meta">{node.type} · {context?.cluster ?? 'No cluster'}</span>
        </div>
      </div>

      {context?.filePath && (
        <div className="dep-detail__path">{context.filePath}</div>
      )}

      {context && (
        <>
          {context.imports.length > 0 && (
            <div className="dep-detail__section">
              <h4 className="dep-detail__section-title dep-detail__section-title--imports">
                Imports ({context.imports.length})
              </h4>
              <div className="dep-detail__list">
                {context.imports.map((imp) => (
                  <button
                    key={imp}
                    className="dep-detail__list-item"
                    onClick={() => onNodeClick(imp)}
                  >
                    {imp.split('/').pop() ?? imp}
                  </button>
                ))}
              </div>
            </div>
          )}

          {context.importedBy.length > 0 && (
            <div className="dep-detail__section">
              <h4 className="dep-detail__section-title dep-detail__section-title--imported-by">
                Imported by ({context.importedBy.length})
              </h4>
              <div className="dep-detail__list">
                {context.importedBy.map((imp) => (
                  <button
                    key={imp}
                    className="dep-detail__list-item"
                    onClick={() => onNodeClick(imp)}
                  >
                    {imp.split('/').pop() ?? imp}
                  </button>
                ))}
              </div>
            </div>
          )}

          {context.calls.length > 0 && (
            <div className="dep-detail__section">
              <h4 className="dep-detail__section-title dep-detail__section-title--calls">
                Calls ({context.calls.length})
              </h4>
              <div className="dep-detail__list">
                {context.calls.map((call) => (
                  <div key={call} className="dep-detail__list-item dep-detail__list-item--plain">
                    {call}
                  </div>
                ))}
              </div>
            </div>
          )}

          {context.processes.length > 0 && (
            <div className="dep-detail__section">
              <h4 className="dep-detail__section-title dep-detail__section-title--processes">
                Processes ({context.processes.length})
              </h4>
              <div className="dep-detail__list">
                {context.processes.map((proc) => (
                  <div key={proc} className="dep-detail__list-item dep-detail__list-item--plain">
                    {proc}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <button className="dep-detail__open-button" onClick={handleOpenInWorkspace}>
        Open in Workspace
      </button>
    </div>
  )
}