import type { useAura } from '../../hooks/useAura'
import { AuraPage } from '../../components/aura/AuraPage'
import { useTheme } from '../../hooks/useTheme'

interface DependenciesPageProps {
  projectId: string
  projectName: string
  workspacePath: string
  onFileOpen?: (filePath: string, startLine?: number) => void
  aura: ReturnType<typeof useAura>
  reportActivity?: (type: 'edit' | 'interaction') => void
}

export function DependenciesPage({ projectId, projectName, workspacePath, onFileOpen, aura, reportActivity }: DependenciesPageProps) {
  const { theme } = useTheme()
  const isLightMode = theme === 'light'

  return (
    <AuraPage
      projectId={projectId}
      projectName={projectName}
      workspacePath={workspacePath}
      onFileOpen={onFileOpen}
      graphData={aura.graphData}
      indexingStatus={aura.indexingStatus}
      selectedNode={aura.selectedNode}
      nodeContext={aura.nodeContext}
      impactResult={aura.impactResult}
      loading={aura.loading}
      error={aura.error}
      searchResults={aura.searchResults}
      startIndexing={aura.startIndexing}
      search={aura.search}
      selectNode={aura.selectNode}
      isLightMode={isLightMode}
      reportActivity={reportActivity}
    />
  )
}