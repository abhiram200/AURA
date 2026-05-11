import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SKILLS_DIR = path.resolve(__dirname, '..', 'skills')

const SKILL_NAMES = [
  'aura-exploring',
  'aura-impact',
  'aura-debugging',
  'aura-refactoring',
  'aura-guide',
]

export async function installSkills(targetDir: string): Promise<{ installed: string[]; skipped: string[] }> {
  const skillsTarget = path.join(targetDir, '.aura', 'skills')
  const installed: string[] = []
  const skipped: string[] = []

  for (const skillName of SKILL_NAMES) {
    const sourcePath = path.join(SKILLS_DIR, skillName, 'SKILL.md')
    if (!fsSync.existsSync(sourcePath)) {
      skipped.push(skillName)
      continue
    }

    const destDir = path.join(skillsTarget, skillName)
    await fs.mkdir(destDir, { recursive: true })

    const content = await fs.readFile(sourcePath, 'utf-8')
    await fs.writeFile(path.join(destDir, 'SKILL.md'), content, 'utf-8')
    installed.push(skillName)
  }

  return { installed, skipped }
}

export function listAvailableSkills(): Array<{ name: string; description: string }> {
  const skills: Array<{ name: string; description: string }> = []

  for (const skillName of SKILL_NAMES) {
    const skillPath = path.join(SKILLS_DIR, skillName, 'SKILL.md')
    if (!fsSync.existsSync(skillPath)) continue

    try {
      const content = fsSync.readFileSync(skillPath, 'utf-8')
      // Parse frontmatter
      const match = content.match(/^---\n([\s\S]*?)\n---/)
      if (match) {
        const frontmatter = match[1]
        const nameMatch = frontmatter.match(/^name:\s*(.+)$/m)
        const descMatch = frontmatter.match(/^description:\s*(.+)$/m)
        skills.push({
          name: nameMatch ? nameMatch[1].trim() : skillName,
          description: descMatch ? descMatch[1].trim() : '',
        })
      }
    } catch {
      // skip
    }
  }

  return skills
}