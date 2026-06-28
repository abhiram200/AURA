import { TasksApp } from './tasks/App'
import './tasks/index.css'

interface TasksPageProps {
  projectId: string
  projectName: string
  workspacePath: string
  reportActivity?: (type: 'edit' | 'interaction') => void
  onOpenGitTree?: () => void
}

export function TasksPage(props: TasksPageProps) {
  return <TasksApp projectId={props.projectId} />
}