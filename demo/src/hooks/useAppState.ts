import { useCallback, useEffect, useMemo, useState } from 'react'
import { confirmDispatch, draftGoal, simulateGenerateGoal, simulateRankingSelect } from '../domain/dispatch'
import { completeDemoTask } from '../domain/dispatch'
import { loadState, resetState, saveState } from '../domain/persistence'
import { deriveProject, fleetRanking, highestScoreSlot } from '../domain/shortLeg'
import type { AppState, GoalCard, ViewMode } from '../domain/types'

export function useAppState() {
  const [state, setState] = useState<AppState>(() => loadState())

  useEffect(() => {
    saveState(state)
  }, [state])

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', state.theme)
    root.classList.toggle('theme-dark', state.theme === 'dark')
    root.classList.toggle('theme-light', state.theme === 'light')
  }, [state.theme])

  const selectedProject = useMemo(
    () => state.projects.find((p) => p.id === state.selectedProjectId) ?? state.projects[0]!,
    [state.projects, state.selectedProjectId],
  )

  const derived = useMemo(() => deriveProject(selectedProject), [selectedProject])
  const ranking = useMemo(() => fleetRanking(state.projects), [state.projects])

  const patch = useCallback((partial: Partial<AppState>) => {
    setState((s) => ({ ...s, ...partial }))
  }, [])

  const setView = useCallback((view: ViewMode) => patch({ view }), [patch])

  const selectProject = useCallback((projectId: string) => {
    patch({ selectedProjectId: projectId, selectedPartId: undefined, selectedWireId: undefined })
  }, [patch])

  const selectPart = useCallback((partId: string) => {
    patch({ selectedPartId: partId, selectedWireId: undefined })
  }, [patch])

  const selectWire = useCallback((wireId: string) => {
    patch({ selectedWireId: wireId })
  }, [patch])

  const confirmMap = useCallback(() => {
    setState((s) => ({
      ...s,
      projects: s.projects.map((p) =>
        p.id === s.selectedProjectId ? { ...p, mapConfirmed: true } : p,
      ),
    }))
  }, [])

  const openRanking = useCallback((projectId: string, partId: string) => {
    setState((s) => simulateRankingSelect(s, projectId, partId))
  }, [])

  const generateGoal = useCallback(
    (wireId?: string) => {
      setState((s) => {
        const project = s.projects.find((p) => p.id === s.selectedProjectId)
        if (!project) return s
        const next = wireId ? { ...s, selectedWireId: wireId } : s
        return simulateGenerateGoal(next, project)
      })
    },
    [],
  )

  const dispatchGoal = useCallback((goal: GoalCard) => {
    setState((s) => confirmDispatch(s, goal))
  }, [])

  const resetDemo = useCallback(() => {
    setState(resetState())
    window.location.reload()
  }, [])

  const toggleTheme = useCallback(() => {
    patch({ theme: state.theme === 'dark' ? 'light' : 'dark' })
  }, [patch, state.theme])

  const completeTask = useCallback((taskId: string) => {
    setState((s) => completeDemoTask(s, taskId))
  }, [])

  const openStub = useCallback((label: string) => patch({ stubDialog: label }), [patch])

  const shortLegSlot = highestScoreSlot(selectedProject)

  return {
    state,
    selectedProject,
    derived,
    ranking,
    shortLegSlot,
    patch,
    setView,
    selectProject,
    selectPart,
    selectWire,
    confirmMap,
    openRanking,
    generateGoal,
    dispatchGoal,
    resetDemo,
    toggleTheme,
    completeTask,
    openStub,
    draftGoal: (partId: string, wireId: string) => draftGoal(selectedProject, partId, wireId),
  }
}

export type AppStore = ReturnType<typeof useAppState>
