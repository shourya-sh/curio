export type ProjectAccent = 'research' | 'plan'

export interface ProjectCard {
  id: string
  title: string
  mode: 'Research' | 'Plan'
  updatedLabel: string
  accent: ProjectAccent
}
