import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-dialog'
import {
  confirmDispatch as applyConfirmDispatch,
  draftGoal,
  factsFromPart,
  frameworkAdviceFromLlm,
  newTaskId,
  plannedWorktreePath,
  taskFromRecord,
} from '../domain/dispatch'
import {
  abandonTask as applyAbandon,
  DEFAULT_STATION_COUNT,
  deriveBoard,
  pauseTask as applyPause,
  resumeTask as applyResume,
  clampStationCount,
} from '../domain/queue'
import {
  MAX_PRELOADED_LOGS,
  appendTaskLine,
  capTaskLines,
} from '../domain/logBuffer'
import { deriveProject, fleetRanking, highestScoreSlot } from '../domain/shortLeg'
import type { ArchitectureProposal } from '../domain/proposal'
import type {
  GoalCard,
  LlmAdviceView,
  LlmProfile,
  Project,
  Task,
  TaskOutputLine,
  ViewMode,
} from '../domain/types'
import {
  api,
  isTauri,
  onMenu,
  onScanProgress,
  onTaskOutput,
  onTaskState,
  profilesFromPrefs,
  type Facts,
  type FileNode,
  type GitChanges,
  type LlmCallRow,
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
  const [llmProfile, setLlmProfileState] = useState('')
  const [llmProfiles, setLlmProfiles] = useState<LlmProfile[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [dispatchTarget, setDispatchTarget] = useState('this-pc')
  const [stubDialog, setStubDialog] = useState<string | undefined>()
  const [folderHint, setFolderHint] = useState(false)
  const addFolderRef = useRef<() => Promise<void>>(async () => {})
  const [scan, setScan] = useState<ScanProgress | null>(null)
  const [factsById, setFactsById] = useState<Record<string, Facts>>({})
  const [files, setFiles] = useState<FileNode | null>(null)
  const [changes, setChanges] = useState<GitChanges | null>(null)
  const [mapOpen, setMapOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [ready, setReady] = useState(!isTauri())
  const [adviceByPart, setAdviceByPart] = useState<Record<string, LlmAdviceView>>({})
  const [llmCalls, setLlmCalls] = useState<LlmCallRow[]>([])
  const [selectedWireId, setSelectedWireId] = useState<string | undefined>()
  const [tasks, setTasks] = useState<Task[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>()
  const [taskLines, setTaskLines] = useState<Record<string, TaskOutputLine[]>>({})
  const [goalDraft, setGoalDraft] = useState<GoalCard | undefined>()
  const [showGoalCard, setShowGoalCard] = useState(false)
  const [dataDir, setDataDir] = useState('/tmp/tinman-data')
  const [dispatchBusy, setDispatchBusy] = useState(false)
  const [stationCount, setStationCountState] = useState(DEFAULT_STATION_COUNT)

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

  const loadTasks = useCallback(async (id: string) => {
    if (!isTauri()) return
    try {
      const rows = await api.listTasks(id)
      setTasks((prev) => {
        const others = prev.filter((t) => t.projectId !== id)
        return [...others, ...rows.map(taskFromRecord)]
      })
      // Only the tasks whose output someone is plausibly looking at. The rest
      // load on selection (selectTask), so this fan-out cannot scale with the
      // number of tasks in the workspace.
      const live = rows.filter((r) => r.state !== 'done' && r.state !== 'abandoned')
      const preload = [...live, ...rows.filter((r) => !live.includes(r))].slice(
        0,
        MAX_PRELOADED_LOGS,
      )
      const logs = await Promise.all(
        preload.map(async (row) => {
          try {
            const lines = await api.readTaskLog(row.id)
            return [
              row.id,
              capTaskLines(
                lines.map((l) => ({
                  task_id: row.id,
                  stream: l.stream,
                  text: l.text,
                })),
              ) as TaskOutputLine[],
            ] as const
          } catch {
            return [row.id, [] as TaskOutputLine[]] as const
          }
        }),
      )
      setTaskLines((m) => {
        const next = { ...m }
        for (const [tid, lines] of logs) next[tid] = lines
        return next
      })
    } catch {
      /* command missing or empty workspace */
    }
  }, [])

  const loadWorkspace = useCallback(async (id: string) => {
    if (!isTauri()) return
    const [ws, facts] = await Promise.all([api.getWorkspace(id), api.getFacts(id)])
    const project = projectFromWorkspace(ws, facts ?? undefined)
    setProjects((prev) => {
      const others = prev.filter((p) => p.id !== id)
      return [...others, project]
    })
    if (facts) setFactsById((m) => ({ ...m, [id]: facts }))
    setLlmProfileState(ws.llm_profile_id ?? '')
    await loadTasks(id)
    return project
  }, [loadTasks])

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
        const [prefs, summaries, paths] = await Promise.all([
          api.getAppPrefs(),
          api.listWorkspaces(),
          api.appPaths().catch(() => ({ data_dir: '/tmp/tinman-data', worktrees_dir: '/tmp/tinman-data/worktrees' })),
        ])
        setDataDir(paths.data_dir)
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
        const current = loaded.find((p) => p.id === last)
        setLlmProfileState(current?.llmProfileId ?? '')
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
        setLlmProfiles(profilesFromPrefs(prefs as Record<string, unknown>))
        if (prefs.dispatchTarget) setDispatchTarget(String(prefs.dispatchTarget))
        if (typeof prefs.station_count === 'number' && prefs.station_count >= 1) {
          setStationCountState(clampStationCount(prefs.station_count))
        }
        if (last) {
          const panel = (prefs.rightPanel as RightKind) || 'facts'
          setRightPanel(panel)
          await refreshSide(last, panel)
          try {
            setLlmCalls(await api.listLlmCalls(last))
          } catch {
            setLlmCalls([])
          }
          await loadTasks(last)
        }
      } catch (e) {
        setError(String(e))
      } finally {
        setReady(true)
      }
    })()
    onScanProgress((p) => setScan(p)).then((u) => unsubs.push(u))
    onTaskOutput((e) => {
      // Bounded on purpose: a chatty child streams for hours, and an unbounded
      // append here grew the webview heap until the window died. logBuffer keeps
      // the tail; the full record stays in the task's log file on disk.
      setTaskLines((m) => ({
        ...m,
        [e.task_id]: appendTaskLine(m[e.task_id] ?? [], {
          task_id: e.task_id,
          stream: e.stream,
          text: e.text,
        }),
      }))
    }).then((u) => unsubs.push(u))
    onTaskState((row) => {
      const next = taskFromRecord(row)
      setTasks((prev) => {
        const others = prev.filter((t) => t.id !== next.id)
        return [...others, next]
      })
      if (row.state === 'done' || row.state === 'checking') {
        void api.getWorkspace(row.workspace_id).then((ws) => {
          const project = projectFromWorkspace(ws)
          setProjects((prev) => {
            const others = prev.filter((p) => p.id !== project.id)
            return [...others, project]
          })
        }).catch(() => undefined)
      }
    }).then((u) => unsubs.push(u))
    onMenu((id) => {
      if (id === 'add-folder') void addFolderRef.current()
      if (id === 'view-robot') setView('robot')
      if (id === 'view-fleet') setView('fleet')
      if (id === 'view-task') setView('task')
    }).then((u) => unsubs.push(u))
    return () => unsubs.forEach((u) => u())
    // Menu listener is subscribed once. addFolderRef.current is updated each
    // render so File → Add Local Folder… sees the latest rightPanel.
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
      setFolderHint(true)
      return
    }
    try {
      const picked = await open({ directory: true, multiple: false })
      if (!picked || Array.isArray(picked)) return
      setError(undefined)
      setScan({ files_seen: 0, phase: 'start', message: picked })
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

  addFolderRef.current = addFolder

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

  const refreshLlmCalls = useCallback(async (id: string) => {
    if (!isTauri()) return
    try {
      setLlmCalls(await api.listLlmCalls(id))
    } catch {
      setLlmCalls([])
    }
  }, [])

  const selectProject = useCallback(
    (id: string) => {
      setSelectedProjectId(id)
      setSelectedPartId(undefined)
      void loadWorkspace(id)
      void refreshSide(id, rightPanel)
      void refreshLlmCalls(id)
    },
    [loadWorkspace, refreshSide, rightPanel, refreshLlmCalls],
  )

  const selectPart = useCallback((partId: string) => {
    setSelectedPartId(partId)
    setSelectedWireId(undefined)
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

  const addCriterion = useCallback(
    async (wireId: string, text: string) => {
      if (!selectedProjectId || !isTauri()) return
      await api.addCriterion(wireId, text)
      await loadWorkspace(selectedProjectId)
    },
    [selectedProjectId, loadWorkspace],
  )

  const generateGoal = useCallback(
    async (wireId: string) => {
      const project = projects.find((p) => p.id === selectedProjectId)
      if (!project || !selectedPartId) return
      setSelectedWireId(wireId)
      let advice: import('../domain/types').FrameworkAdvice | null = null
      let reason: import('../domain/types').LlmUnavailableReason | 'hand_filled' = 'hand_filled'
      if (isTauri()) {
        try {
          const result = await api.llmCall(project.id, 'draft_goal', {
            slot: project.parts.find((p) => p.id === selectedPartId)?.slot,
            label: project.parts.find((p) => p.id === selectedPartId)?.label,
            wire_id: wireId,
            intent: composerDraft,
            facts: factsById[project.id] ?? null,
          })
          const parsed = frameworkAdviceFromLlm(result)
          advice = parsed.advice
          if (!advice) reason = parsed.reason ?? 'rejected'
        } catch {
          reason = 'offline'
        }
        await refreshLlmCalls(project.id)
      } else {
        reason = 'no_profile'
      }
      const taskId = newTaskId()
      const goal = draftGoal({
        taskId,
        project,
        partId: selectedPartId,
        wireId,
        userIntentVerbatim: composerDraft ? [composerDraft] : [],
        attachments,
        facts: factsFromPart(project, selectedPartId),
        advice,
        adviceUnavailableReason: advice ? undefined : reason,
        worktreePath: plannedWorktreePath(taskId, dataDir),
      })
      setGoalDraft(goal)
      setShowGoalCard(true)
    },
    [
      projects,
      selectedProjectId,
      selectedPartId,
      composerDraft,
      attachments,
      factsById,
      dataDir,
      refreshLlmCalls,
    ],
  )

  const clearGoalDraft = useCallback(() => {
    setGoalDraft(undefined)
    setShowGoalCard(false)
  }, [])

  // R2 / C2: composer send affordance. Resolve the target wire from
  // selectedWireId (if it belongs to the selected part) or the selected
  // part's first wire. Empty/whitespace draft is a no-op. No part selected
  // (or part has no wires) → visible error via setError, not silence.
  // Then delegates to the existing generateGoal flow.
  const sendComposer = useCallback(async () => {
    if (!composerDraft.trim()) return
    const project = projects.find((p) => p.id === selectedProjectId)
    if (!project || !selectedPartId) {
      setError('请先在 Robot 视图选中一个部件')
      return
    }
    const part = project.parts.find((p) => p.id === selectedPartId)
    if (!part || part.wires.length === 0) {
      setError('当前部件没有线路，无法发送')
      return
    }
    const targetWire =
      selectedWireId && part.wires.some((w) => w.id === selectedWireId)
        ? selectedWireId
        : part.wires[0]!.id
    await generateGoal(targetWire)
  }, [composerDraft, projects, selectedProjectId, selectedPartId, selectedWireId, generateGoal])

  const confirmDispatch = useCallback(async () => {
    if (!goalDraft || !selectedProjectId) return
    if (!isTauri()) {
      const next = applyConfirmDispatch(
        {
          theme,
          view,
          selectedProjectId,
          selectedPartId,
          selectedWireId,
          projects,
          stations: Array.from({ length: stationCount }, (_, i) => ({
            id: String(i + 1),
            label: `工位 ${i + 1}`,
          })),
          tasks,
          queue: [],
          goalDraft,
          rightPanel,
          leftCollapsed,
          fleetSort,
          showGoalCard,
          composerDraft,
          attachments,
          dispatchTarget,
        },
        goalDraft,
      )
      setTasks(next.tasks)
      setSelectedTaskId(next.selectedTaskId)
      setGoalDraft(undefined)
      setShowGoalCard(false)
      setView('task')
      setRightPanel('terminal')
      return
    }
    setDispatchBusy(true)
    setError(undefined)
    try {
      const row = await api.dispatchTask(
        selectedProjectId,
        selectedPartId ?? '',
        selectedWireId ?? '',
        goalDraft,
        dispatchTarget,
      )
      const task = taskFromRecord(row)
      setTasks((prev) => [...prev.filter((t) => t.id !== task.id), task])
      setSelectedTaskId(task.id)
      setGoalDraft(undefined)
      setShowGoalCard(false)
      setView('task')
      setRightPanel('terminal')
      try {
        const log = await api.readTaskLog(task.id)
        setTaskLines((m) => ({
          ...m,
          [task.id]: capTaskLines(
            log.map((l) => ({ task_id: task.id, stream: l.stream, text: l.text })),
          ),
        }))
      } catch {
        /* empty log is fine */
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setDispatchBusy(false)
    }
  }, [
    goalDraft,
    selectedProjectId,
    selectedPartId,
    selectedWireId,
    dispatchTarget,
    theme,
    view,
    projects,
    tasks,
    rightPanel,
    leftCollapsed,
    fleetSort,
    showGoalCard,
    composerDraft,
    attachments,
    stationCount,
  ])

  const fetchTaskLog = useCallback(async (taskId: string) => {
    if (!isTauri()) return
    try {
      const lines = await api.readTaskLog(taskId)
      setTaskLines((m) => ({
        ...m,
        [taskId]: capTaskLines(
          lines.map((l) => ({ task_id: taskId, stream: l.stream, text: l.text })),
        ),
      }))
    } catch {
      /* command missing, or the task has no log yet */
    }
  }, [])

  const selectTask = useCallback((taskId: string) => {
    setSelectedTaskId(taskId)
    void fetchTaskLog(taskId)
    setView('task')
    setRightPanel('terminal')
  }, [fetchTaskLog])

  const setLlmProfile = useCallback(
    async (id: string) => {
      setLlmProfileState(id)
      if (isTauri() && selectedProjectId) {
        try {
          await api.setWorkspaceLlmProfile(selectedProjectId, id || null)
        } catch {
          /* profile write is best-effort */
        }
      }
      if (selectedProjectId) {
        setProjects((prev) =>
          prev.map((p) => (p.id === selectedProjectId ? { ...p, llmProfileId: id } : p)),
        )
      }
    },
    [selectedProjectId],
  )

  const saveLlmProfile = useCallback(
    async (profile: LlmProfile, secret?: string) => {
      setLlmProfiles((prev) => [...prev.filter((p) => p.id !== profile.id), profile])
      // R2 / C1: auto-select the saved profile. The composer's <select> already
      // shows the first profile when llmProfile is '', which made it look active
      // while store value was '' — llm_call then resolved profile_id = None
      // and surfaced Unavailable NoProfile.
      await setLlmProfile(profile.id)
      if (!isTauri()) return
      try {
        const current = await api.getAppPrefs()
        const existing = profilesFromPrefs(current as Record<string, unknown>)
        const next = [...existing.filter((p) => p.id !== profile.id), profile]
        await api.setAppPrefs({ ...current, llm_profiles: next })
        if (secret && profile.key_ref) {
          await api.setLlmKey(profile.key_ref, secret)
        }
      } catch (e) {
        // R2 / C1: surface save failures via the existing error banner
        // instead of swallowing them silently.
        setError(String(e))
      }
    },
    [setLlmProfile],
  )

  const pauseTask = useCallback(
    async (id: string) => {
      if (!isTauri()) {
        setTasks((prev) => applyPause(prev, id, stationCount))
        return
      }
      try {
        await api.pauseTask(id)
        if (selectedProjectId) await loadTasks(selectedProjectId)
      } catch (e) {
        setError(String(e))
      }
    },
    [stationCount, selectedProjectId, loadTasks],
  )

  const resumeTask = useCallback(
    async (id: string) => {
      if (!isTauri()) {
        setTasks((prev) => applyResume(prev, id, stationCount))
        return
      }
      try {
        await api.resumeTask(id)
        if (selectedProjectId) await loadTasks(selectedProjectId)
      } catch (e) {
        setError(String(e))
      }
    },
    [stationCount, selectedProjectId, loadTasks],
  )

  const abandonTask = useCallback(
    async (id: string) => {
      if (!isTauri()) {
        setTasks((prev) => applyAbandon(prev, id, stationCount))
        return
      }
      try {
        await api.abandonTask(id)
        if (selectedProjectId) await loadTasks(selectedProjectId)
      } catch (e) {
        setError(String(e))
      }
    },
    [stationCount, selectedProjectId, loadTasks],
  )

  const takeOver = useCallback(
    (id: string) => {
      void pauseTask(id)
      selectTask(id)
    },
    [pauseTask, selectTask],
  )

  const removeWorktree = useCallback(async (id: string) => {
    if (!isTauri()) return
    try {
      await api.removeWorktree(id)
    } catch (e) {
      setError(String(e))
    }
  }, [])

  const setStationCount = useCallback(
    async (n: number) => {
      const next = clampStationCount(n)
      setStationCountState(next)
      if (isTauri()) {
        try {
          const current = await api.getAppPrefs()
          await api.setAppPrefs({ ...current, station_count: next })
        } catch {
          /* prefs write is best-effort */
        }
      }
    },
    [],
  )

  const board = useMemo(() => deriveBoard(tasks, stationCount), [tasks, stationCount])

  const requestAdvice = useCallback(async () => {
    if (!selectedProjectId || !selectedPartId || !isTauri()) return
    const project = projects.find((p) => p.id === selectedProjectId)
    const part = project?.parts.find((p) => p.id === selectedPartId)
    if (!part) return
    try {
      const result = await api.llmCall(selectedProjectId, 'advise_part', {
        slot: part.slot,
        label: part.label,
        facts: factsById[selectedProjectId] ?? null,
        wires: part.wires.map((w) => ({
          id: w.id,
          label: w.label,
          criteria: w.criteria,
        })),
      })
      const view: LlmAdviceView =
        result.status === 'available' && result.advice
          ? { status: 'available', advice: result.advice }
          : result.status === 'unavailable'
            ? {
                status: 'unavailable',
                reason: result.reason,
                detail: result.detail ?? result.reject_reason ?? undefined,
              }
            : { status: 'unavailable', reason: 'rejected' }
      setAdviceByPart((m) => ({ ...m, [selectedPartId]: view }))
      await refreshLlmCalls(selectedProjectId)
    } catch {
      setAdviceByPart((m) => ({
        ...m,
        [selectedPartId]: { status: 'unavailable', reason: 'offline' },
      }))
    }
  }, [selectedProjectId, selectedPartId, projects, factsById, refreshLlmCalls])

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
  const partAdvice: LlmAdviceView = selectedPartId
    ? (adviceByPart[selectedPartId] ?? { status: 'idle' })
    : { status: 'idle' }

  return {
    ready,
    error,
    projects,
    selectedProject,
    selectedProjectId,
    selectedPartId,
    selectedWireId,
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
    llmProfiles,
    dispatchTarget,
    setDispatchTarget,
    stubDialog,
    openStub: (label: string) => setStubDialog(label),
    closeStub: () => setStubDialog(undefined),
    folderHint,
    closeFolderHint: () => setFolderHint(false),
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
    addCriterion,
    requestAdvice,
    generateGoal,
    confirmDispatch,
    clearGoalDraft,
    selectTask,
    goalDraft,
    showGoalCard,
    dispatchBusy,
    tasks,
    selectedTaskId,
    taskLines,
    stationCount,
    setStationCount,
    stations: board.stations,
    queue: board.queue,
    settingsOpen,
    openSettings: () => setSettingsOpen(true),
    closeSettings: () => setSettingsOpen(false),
    saveLlmProfile,
    pauseTask,
    resumeTask,
    abandonTask,
    takeOver,
    removeWorktree,
    partAdvice,
    llmCalls,
    rescan,
    modules,
    mapDraft,
    scanning: scan !== null && scan.phase !== 'done',
  }
}

export type AppStore = ReturnType<typeof useAppState>
