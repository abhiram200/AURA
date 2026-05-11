import type { useAura } from '../../hooks/useAura'
import { AuraPage } from '../../components/aura/AuraPage'
import { useTheme } from '../../hooks/useTheme'

interface DependenciesPageProps {
  projectId: string
  projectName: string
  workspacePath: string
  conversationId: string | null
  onFileOpen?: (filePath: string, startLine?: number) => void
  aura: ReturnType<typeof useAura>
}

export function DependenciesPage({ projectId, projectName, workspacePath, conversationId: _conversationId, onFileOpen, aura }: DependenciesPageProps) {
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
    />
  )
}