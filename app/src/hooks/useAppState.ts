import { useCallback, useEffect, useMemo, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-dialog'
import { deriveProject, fleetRanking, highestScoreSlot } from '../domain/shortLeg'
import type { ArchitectureProposal } from '../domain/proposal'
import type { Project, ViewMode } from '../domain/types'
import {
  api,
  isTauri,
  onMenu,
  onScanProgress,
  type Facts,
  type FileNode,
  type GitChanges,
  type ScanProgress,
} from '../lib/api'
import { modulesFromFacts, projectFromSummary, projectFromWorkspace } from '../lib/mapWorkspace'

export type RightKind = 'changes' | 'browser' | 'terminal' | 'files' | 'facts'

export function useAppState() {
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>()
  const [selectedPartId, setSelectedPartId] = useState<string | undefined>()
  const [view, setView] = useState<ViewMode>('fleet')
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system')
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [fleetSort, setFleetSort] = useState<'shortleg' | 'name' | 'recent'>('shortleg')
  const [rightPanel, setRightPanel] = useState<RightKind>('facts')
  const [composerDraft, setComposerDraft] = useState('')
  const [attachments, setAttachments] = useState<string[]>([])
  const [llmProfile, setLlmProfile] = useState('extra-high')
  const [dispatchTarget, setDispatchTarget] = useState('this-pc')
  const [stubDialog, setStubDialog] = useState<string | undefined>()
  const [scan, setScan] = useState<ScanProgress | null>(null)
  const [factsById, setFactsById] = useState<Record<string, Facts>>({})
  const [files, setFiles] = useState<FileNode | null>(null)
  const [changes, setChanges] = useState<GitChanges | null>(null)
  const [mapOpen, setMapOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [ready, setReady] = useState(!isTauri())

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId),
    [projects, selectedProjectId],
  )

  const derived = useMemo(
    () => (selectedProject ? deriveProject(selectedProject) : undefined),
    [selectedProject],
  )
  const ranking = useMemo(() => fleetRanking(projects), [projects])
  const shortLegSlot = selectedProject ? highestScoreSlot(selectedProject) : undefined
  const facts = selectedProjectId ? factsById[selectedProjectId] : undefined

  const persistChrome = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!isTauri()) return
      const current = await api.getAppPrefs()
      await api.setAppPrefs({ ...current, ...patch })
    },
    [],
  )

  const loadWorkspace = useCallback(async (id: string) => {
    if (!isTauri()) return
    const [ws, facts] = await Promise.all([api.getWorkspace(id), api.getFacts(id)])
    const project = projectFromWorkspace(ws, facts ?? undefined)
    setProjects((prev) => {
      const others = prev.filter((p) => p.id !== id)
      return [...others, project]
    })
    if (facts) setFactsById((m) => ({ ...m, [id]: facts }))
    return project
  }, [])

  const refreshSide = useCallback(async (id: string, panel: RightKind) => {
    if (!isTauri()) return
    try {
      if (panel === 'files') setFiles(await api.listFiles(id))
      if (panel === 'changes') setChanges(await api.gitChanges(id))
      if (panel === 'facts') {
        const f = await api.getFacts(id)
        if (f) setFactsById((m) => ({ ...m, [id]: f }))
      }
    } catch (e) {
      setError(String(e))
    }
  }, [])

  useEffect(() => {
    if (!isTauri()) return
    let unsubs: Array<() => void> = []
    ;(async () => {
      try {
        const [prefs, summaries] = await Promise.all([api.getAppPrefs(), api.listWorkspaces()])
        const loaded = await Promise.all(
          summaries.map(async (s) => {
            try {
              const ws = await api.getWorkspace(s.id)
              const f = await api.getFacts(s.id)
              if (f) setFactsById((m) => ({ ...m, [s.id]: f }))
              return projectFromWorkspace(ws, f ?? undefined)
            } catch {
              return projectFromSummary(s)
            }
          }),
        )
        setProjects(loaded)
        const last = (prefs.lastWorkspaceId as string | undefined) ?? loaded[0]?.id
        setSelectedProjectId(last)
        if (prefs.view === 'robot' || prefs.view === 'fleet' || prefs.view === 'task') {
          setView(prefs.view)
        }
        if (prefs.theme === 'light' || prefs.theme === 'dark' || prefs.theme === 'system') {
          setTheme(prefs.theme)
        }
        if (typeof prefs.leftCollapsed === 'boolean') setLeftCollapsed(prefs.leftCollapsed)
        if (prefs.fleetSort === 'shortleg' || prefs.fleetSort === 'name' || prefs.fleetSort === 'recent') {
          setFleetSort(prefs.fleetSort)
        }
        if (prefs.llmProfile) setLlmProfile(String(prefs.llmProfile))
        if (prefs.dispatchTarget) setDispatchTarget(String(prefs.dispatchTarget))
        if (last) {
          const panel = (prefs.rightPanel as RightKind) || 'facts'
          setRightPanel(panel)
          await refreshSide(last, panel)
        }
      } catch (e) {
        setError(String(e))
      } finally {
        setReady(true)
      }
    })()
    onScanProgress((p) => setScan(p)).then((u) => unsubs.push(u))
    onMenu((id) => {
      if (id === 'add-folder') void addFolder()
      if (id === 'view-robot') setView('robot')
      if (id === 'view-fleet') setView('fleet')
      if (id === 'view-task') setView('task')
    }).then((u) => unsubs.push(u))
    return () => unsubs.forEach((u) => u())
    // addFolder is defined below; menu handler closes over the latest via event
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') {
      root.removeAttribute('data-theme')
    } else {
      root.setAttribute('data-theme', theme)
    }
    root.classList.toggle('theme-dark', theme === 'dark')
    root.classList.toggle('theme-light', theme === 'light')
  }, [theme])

  useEffect(() => {
    if (!isTauri() || !selectedProject) return
    getCurrentWindow()
      .setTitle(selectedProject.name)
      .catch(() => undefined)
    void persistChrome({ lastWorkspaceId: selectedProject.id, view, fleetSort, theme, leftCollapsed })
  }, [selectedProject, view, fleetSort, theme, leftCollapsed, persistChrome])

  const addFolder = useCallback(async () => {
    if (!isTauri()) {
      setStubDialog('Add Local Folder needs the desktop app')
      return
    }
    const picked = await open({ directory: true, multiple: false })
    if (!picked || Array.isArray(picked)) return
    setError(undefined)
    setScan({ files_seen: 0, phase: 'start', message: picked })
    try {
      const created = await api.createWorkspace(picked)
      setScan({ files_seen: 0, phase: 'walk', message: 'scanning…' })
      const facts = await api.scanWorkspace(created.id)
      const project = projectFromWorkspace(created, facts)
      setFactsById((m) => ({ ...m, [created.id]: facts }))
      setProjects((prev) => [project, ...prev.filter((p) => p.id !== project.id)])
      setSelectedProjectId(created.id)
      setSelectedPartId(undefined)
      setView('robot')
      setMapOpen(true)
      setScan({
        files_seen: facts.file_count,
        phase: 'done',
        message: `${facts.duration_ms} ms · ${facts.file_count} files`,
      })
      await refreshSide(created.id, rightPanel)
    } catch (e) {
      setError(String(e))
      setScan(null)
    }
  }, [refreshSide, rightPanel])

  const confirmMap = useCallback(
    async (proposal: ArchitectureProposal, name?: string) => {
      if (!selectedProjectId || !isTauri()) return
      const ws = await api.confirmMap(selectedProjectId, proposal, name)
      const facts = factsById[selectedProjectId]
      const project = projectFromWorkspace(ws, facts)
      setProjects((prev) => prev.map((p) => (p.id === project.id ? project : p)))
      setMapOpen(false)
      setScan(null)
    },
    [selectedProjectId, factsById],
  )

  const saveMapDraft = useCallback(
    async (proposal: ArchitectureProposal) => {
      if (!selectedProjectId || !isTauri()) return
      await api.updatePrefs(selectedProjectId, { mapDraft: proposal })
    },
    [selectedProjectId],
  )

  const selectProject = useCallback(
    (id: string) => {
      setSelectedProjectId(id)
      setSelectedPartId(undefined)
      void loadWorkspace(id)
      void refreshSide(id, rightPanel)
    },
    [loadWorkspace, refreshSide, rightPanel],
  )

  const selectPart = useCallback((partId: string) => {
    setSelectedPartId(partId)
  }, [])

  const openRanking = useCallback(
    (projectId: string, partId: string) => {
      selectProject(projectId)
      setSelectedPartId(partId)
      setView('robot')
    },
    [selectProject],
  )

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : t === 'light' ? 'system' : 'dark'
      return next
    })
  }, [])

  const setRight = useCallback(
    (panel: RightKind) => {
      setRightPanel(panel)
      if (selectedProjectId) void refreshSide(selectedProjectId, panel)
    },
    [selectedProjectId, refreshSide],
  )

  const setCriterion = useCallback(
    async (wireId: string, index: number, met: boolean) => {
      if (!selectedProjectId || !isTauri()) return
      await api.setCriterionMet(wireId, index, met)
      await loadWorkspace(selectedProjectId)
    },
    [selectedProjectId, loadWorkspace],
  )

  const rescan = useCallback(async () => {
    if (!selectedProjectId || !isTauri()) return
    setScan({ files_seen: 0, phase: 'walk', message: 'rescanning…' })
    try {
      const facts = await api.scanWorkspace(selectedProjectId)
      setFactsById((m) => ({ ...m, [selectedProjectId]: facts }))
      await loadWorkspace(selectedProjectId)
      setScan({
        files_seen: facts.file_count,
        phase: 'done',
        message: `${facts.duration_ms} ms`,
      })
    } catch (e) {
      setError(String(e))
      setScan(null)
    }
  }, [selectedProjectId, loadWorkspace])

  const modules = facts ? modulesFromFacts(facts) : []
  const mapDraft = selectedProject?.mapDraft

  return {
    ready,
    error,
    projects,
    selectedProject,
    selectedProjectId,
    selectedPartId,
    derived,
    ranking,
    shortLegSlot,
    view,
    setView,
    theme,
    toggleTheme,
    leftCollapsed,
    setLeftCollapsed,
    fleetSort,
    setFleetSort,
    rightPanel,
    setRight,
    composerDraft,
    setComposerDraft,
    attachments,
    setAttachments,
    llmProfile,
    setLlmProfile,
    dispatchTarget,
    setDispatchTarget,
    stubDialog,
    openStub: (label: string) => setStubDialog(label),
    closeStub: () => setStubDialog(undefined),
    clearError: () => setError(undefined),
    scan,
    facts,
    files,
    changes,
    mapOpen,
    setMapOpen,
    filter,
    setFilter,
    addFolder,
    confirmMap,
    saveMapDraft,
    selectProject,
    selectPart,
    openRanking,
    setCriterion,
    rescan,
    modules,
    mapDraft,
    scanning: scan !== null && scan.phase !== 'done',
  }
}

export type AppStore = ReturnType<typeof useAppState>
