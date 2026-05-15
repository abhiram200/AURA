import path from 'path'
import fs from 'fs/promises'

// Re-use the AuraTodoItem shape from agent.ts
export interface PlanTodoItem {
  id: string
  subject: string
  description: string
  status: 'pending' | 'in_progress' | 'completed'
  blockedBy?: string[]
}

export interface SavedPlan {
  slug: string
  originalPrompt: string
  branchName: string
  planMarkdown: string
  createdAt: string
  updatedAt: string
  todos: PlanTodoItem[]
}

export class PlanPersistenceService {
  private plansDir(projectPath: string): string {
    return path.join(projectPath, '.aura', 'plans')
  }

  private async ensureDir(projectPath: string): Promise<void> {
    await fs.mkdir(this.plansDir(projectPath), { recursive: true })
  }

  async savePlan(projectPath: string, plan: SavedPlan): Promise<void> {
    await this.ensureDir(projectPath)
    plan.updatedAt = new Date().toISOString()
    const filePath = path.join(this.plansDir(projectPath), `${plan.slug}.json`)
    await fs.writeFile(filePath, JSON.stringify(plan, null, 2), 'utf-8')
  }

  async loadPlan(projectPath: string, slug: string): Promise<SavedPlan | null> {
    try {
      const filePath = path.join(this.plansDir(projectPath), `${slug}.json`)
      const raw = await fs.readFile(filePath, 'utf-8')
      return JSON.parse(raw) as SavedPlan
    } catch {
      return null
    }
  }

  async loadActivePlan(projectPath: string, branchName: string): Promise<SavedPlan | null> {
    // 1. Try deriving slug from branch name first (exact match)
    if (branchName && branchName.startsWith('aura/')) {
      const slug = branchName.slice(5) // strip "aura/" prefix
      const plan = await this.loadPlan(projectPath, slug)
      if (plan) return plan
    }

    // 2. Scan all plan files for matching branchName
    const plans = await this.listPlans(projectPath)
    const byBranch = plans.find(p => p.branchName === branchName)
    if (byBranch) return byBranch

    // 3. Find the most recent plan with pending work (regardless of branch)
    // This handles "continue" messages where the user is on main/master
    const activePlans = plans
      .filter(p => p.todos.some(t => t.status !== 'completed'))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    return activePlans[0] || null
  }

  async deletePlan(projectPath: string, slug: string): Promise<void> {
    try {
      const filePath = path.join(this.plansDir(projectPath), `${slug}.json`)
      await fs.unlink(filePath)
    } catch {
      // File doesn't exist — no-op
    }
  }

  async listPlans(projectPath: string): Promise<SavedPlan[]> {
    try {
      const dir = this.plansDir(projectPath)
      const files = await fs.readdir(dir)
      const plans: SavedPlan[] = []
      for (const file of files) {
        if (!file.endsWith('.json')) continue
        try {
          const raw = await fs.readFile(path.join(dir, file), 'utf-8')
          const plan = JSON.parse(raw) as SavedPlan
          plans.push(plan)
        } catch {
          // Corrupt file — delete it
          try { await fs.unlink(path.join(dir, file)) } catch {}
        }
      }
      return plans
    } catch {
      return []
    }
  }

  /** Delete plan files whose branches no longer exist */
  async cleanupStalePlans(projectPath: string, existingBranches: string[]): Promise<void> {
    const plans = await this.listPlans(projectPath)
    const branchSet = new Set(existingBranches)
    for (const plan of plans) {
      if (plan.branchName && plan.branchName.startsWith('aura/') && !branchSet.has(plan.branchName)) {
        await this.deletePlan(projectPath, plan.slug)
      }
    }
  }
}