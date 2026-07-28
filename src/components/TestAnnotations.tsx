"use client"

import { useState, useEffect, useCallback } from 'react'
import { useTheme } from 'next-themes'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Plus, MessageSquare, Edit2, Trash2, Check, X, GripVertical, Trash, ChevronDown, ChevronRight, Settings2 } from 'lucide-react'
import { useTimezone } from '@/contexts/TimezoneContext'
import { useAnnotationCache, type AnnotationQuickOption } from '@/contexts/AnnotationCacheContext'
import DeleteOptionModal from './DeleteOptionModal'
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  useDraggable,
  useDroppable,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'

interface Annotation {
  annotation_id: number | string
  serial_number: string
  start_time: string
  annotation_type: string
  annotation_text: string
  group_name: string | null
  group_color: string | null
  created_by?: string
  author_email?: string
  created_at: string
  updated_at: string
  current_test_id?: number
  pending?: boolean
}

interface TestAnnotationsProps {
  testId: number
  serialNumber: string
  startTime: string
  /** Overall test status (e.g. PASS / FAIL) — enables FAIL empty CTA */
  overallStatus?: string
}

/** Compact relative time for annotation cards; absolute value stays in title tooltip. */
function formatRelativeTime(utcDateString: string): string {
  const date = new Date(utcDateString)
  if (Number.isNaN(date.getTime())) return ''

  const diffMs = date.getTime() - Date.now()
  const absMs = Math.abs(diffMs)
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  const week = 7 * day
  const month = 30 * day
  const year = 365 * day

  if (absMs < minute) return 'just now'
  if (absMs < hour) return rtf.format(Math.round(diffMs / minute), 'minute')
  if (absMs < day) return rtf.format(Math.round(diffMs / hour), 'hour')
  if (absMs < week) return rtf.format(Math.round(diffMs / day), 'day')
  if (absMs < month) return rtf.format(Math.round(diffMs / week), 'week')
  if (absMs < year) return rtf.format(Math.round(diffMs / month), 'month')
  return rtf.format(Math.round(diffMs / year), 'year')
}

// Draggable quick option chip
function DraggableQuickOption({
  option,
  accentColor,
  onClick
}: {
  option: AnnotationQuickOption
  accentColor?: string
  onClick: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `option-${option.option_id}`,
    data: { option }
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="relative">
      <button
        type="button"
        onClick={onClick}
        title={`Add "${option.option_text}" to this test`}
        className="inline-flex items-center rounded-md border bg-background py-1 pl-2.5 pr-6 text-xs font-medium transition-colors hover:bg-muted"
        style={
          accentColor
            ? {
                borderColor: `${accentColor}66`,
                backgroundColor: `${accentColor}14`,
              }
            : undefined
        }
      >
        {option.option_text}
      </button>
      <div
        {...listeners}
        {...attributes}
        className="absolute right-0 top-0 flex h-full items-center rounded-r-md px-1 cursor-grab active:cursor-grabbing hover:bg-muted"
        title="Drag to reassign group or delete"
      >
        <GripVertical className="h-3 w-3 text-muted-foreground" />
      </div>
    </div>
  )
}

// Delete zone component that appears during drag
function DeleteZone({ isDragging }: { isDragging: boolean }) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'delete-zone',
    data: { isDeleteZone: true }
  })

  if (!isDragging) return null

  return (
    <div
      ref={setNodeRef}
      className={`border-2 border-dashed rounded-lg p-4 flex flex-col items-center justify-center gap-2 transition-all ${
        isOver
          ? 'border-red-500 bg-red-50 dark:bg-red-950/30 scale-105'
          : 'border-red-300 dark:border-red-800 bg-red-50/50 dark:bg-red-950/10'
      }`}
      style={{
        animation: isDragging ? 'slideDown 0.2s ease-out' : undefined
      }}
    >
      <Trash className={`h-6 w-6 transition-colors ${isOver ? 'text-red-600 dark:text-red-400' : 'text-red-400 dark:text-red-600'}`} />
      <p className={`text-sm font-medium transition-colors ${isOver ? 'text-red-700 dark:text-red-300' : 'text-red-500 dark:text-red-500'}`}>
        {isOver ? 'Release to delete' : 'Drag here to delete'}
      </p>
    </div>
  )
}

// Droppable group container component
function DroppableGroup({
  groupName,
  color,
  optionCount,
  children,
  isCollapsed,
  onToggle,
  onDelete
}: {
  groupName: string
  color: string
  optionCount: number
  children: React.ReactNode
  isCollapsed: boolean
  onToggle: () => void
  onDelete?: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `group-${groupName}`,
    data: { groupName }
  })

  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border transition-all group/group ${isOver && !isCollapsed ? 'ring-2 ring-ring ring-offset-1' : ''}`}
    >
      {/* Group Header */}
      <div className="flex w-full items-center gap-2 px-2.5 py-1.5">
        <button
          onClick={onToggle}
          className="flex flex-1 items-center gap-2 text-left transition-opacity hover:opacity-75"
        >
          {isCollapsed
            ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-xs font-semibold">{groupName}</span>
          <span className="text-xs tabular-nums text-muted-foreground">{optionCount}</span>
        </button>
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="rounded p-1 opacity-0 transition-opacity hover:bg-muted group-hover/group:opacity-100"
            title="Delete group (only if empty)"
          >
            <Trash className="h-3 w-3 text-muted-foreground" />
          </button>
        )}
      </div>

      {/* Group Options */}
      {!isCollapsed && (
        <div className="flex flex-wrap gap-1.5 px-2.5 pb-2.5">
          {children}
        </div>
      )}
    </div>
  )
}

export default function TestAnnotations({
  testId,
  serialNumber,
  startTime,
  overallStatus,
}: TestAnnotationsProps) {
  const { resolvedTheme } = useTheme()
  const { data: session } = useSession()
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [annotationsLoading, setAnnotationsLoading] = useState(true)
  const [showCustomForm, setShowCustomForm] = useState(false)
  const [customText, setCustomText] = useState('')
  const [newOptionText, setNewOptionText] = useState('')
  const [newOptionGroup, setNewOptionGroup] = useState<string>('')
  const [showNewGroupForm, setShowNewGroupForm] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [manageOpen, setManageOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | string | null>(null)
  const [editText, setEditText] = useState('')
  const [deleteOptionModal, setDeleteOptionModal] = useState<{ optionId: number; optionText: string } | null>(null)
  const [isDraggingOption, setIsDraggingOption] = useState(false)
  const { formatInTimezone } = useTimezone()
  const { quickOptions, groups, refetchOptions, refetchGroups } = useAnnotationCache()

  // Configure drag sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px movement before drag starts
      },
    })
  )

  const fetchAnnotations = useCallback(async () => {
    try {
      const response = await fetch(`/api/test/${testId}/annotations`)
      if (response.ok) {
        const data = await response.json()
        // Preserve in-flight optimistic rows so a concurrent refetch does not wipe them
        setAnnotations((prev) => {
          const pending = prev.filter((a) => a.pending)
          const serverIds = new Set(data.map((a: Annotation) => a.annotation_id))
          const stillPending = pending.filter((a) => !serverIds.has(a.annotation_id))
          return [...stillPending, ...data]
        })
      }
    } catch (error) {
      console.error('Failed to fetch annotations:', error)
    }
  }, [testId])

  useEffect(() => {
    const loadData = async () => {
      setAnnotationsLoading(true)
      await fetchAnnotations()
      setAnnotationsLoading(false)
    }
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testId]) // Only refetch when testId changes, not when fetchAnnotations reference changes

  // FAIL + zero annotations: keep top quick-annotate groups expanded
  useEffect(() => {
    if (
      annotationsLoading ||
      annotations.length > 0 ||
      overallStatus !== 'FAIL' ||
      groups.length === 0
    ) {
      return
    }
    const topGroupNames = groups.slice(0, 3).map((g) => g.group_name)
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const name of topGroupNames) {
        if (next.has(name)) {
          next.delete(name)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [annotationsLoading, annotations.length, overallStatus, groups])

  const addQuickAnnotation = async (
    optionText: string,
    groupName: string | null = null,
    groupColor: string | null = null
  ) => {
    const tempId = `temp-${crypto.randomUUID()}`
    const now = new Date().toISOString()
    const optimistic: Annotation = {
      annotation_id: tempId,
      serial_number: serialNumber,
      start_time: startTime,
      annotation_type: 'failure_cause',
      annotation_text: optionText,
      group_name: groupName,
      group_color: groupColor,
      created_by: session?.user?.name || 'You',
      author_email: session?.user?.email || undefined,
      created_at: now,
      updated_at: now,
      current_test_id: testId,
      pending: true,
    }

    setAnnotations((prev) => [optimistic, ...prev])

    try {
      const response = await fetch(`/api/test/${testId}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          annotation_type: 'failure_cause',
          annotation_text: optionText
        })
      })

      if (response.ok) {
        const created: Annotation = await response.json()
        setAnnotations((prev) =>
          prev.map((a) => (a.annotation_id === tempId ? { ...created, pending: false } : a))
        )
      } else {
        setAnnotations((prev) => prev.filter((a) => a.annotation_id !== tempId))
        toast.error('Failed to add annotation')
        console.error('Failed to add annotation')
      }
    } catch (error) {
      setAnnotations((prev) => prev.filter((a) => a.annotation_id !== tempId))
      toast.error('Failed to add annotation')
      console.error('Error adding annotation:', error)
    }
  }

  const addCustomAnnotation = async () => {
    if (!customText.trim()) return

    try {
      const response = await fetch(`/api/test/${testId}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          annotation_type: 'custom_note',
          annotation_text: customText.trim()
        })
      })

      if (response.ok) {
        setCustomText('')
        setShowCustomForm(false)
        await fetchAnnotations()
      } else {
        toast.error('Failed to add custom note')
        console.error('Failed to add custom annotation')
      }
    } catch (error) {
      toast.error('Failed to add custom note')
      console.error('Error adding custom annotation:', error)
    }
  }

  const updateAnnotation = async (annotationId: number | string, newText: string) => {
    if (typeof annotationId !== 'number') return

    try {
      const response = await fetch(`/api/annotations/${annotationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          annotation_text: newText.trim()
        })
      })

      if (response.ok) {
        setEditingId(null)
        setEditText('')
        await fetchAnnotations()
      } else {
        toast.error('Failed to update annotation')
        console.error('Failed to update annotation')
      }
    } catch (error) {
      toast.error('Failed to update annotation')
      console.error('Error updating annotation:', error)
    }
  }

  const deleteAnnotation = async (annotationId: number | string) => {
    if (typeof annotationId !== 'number') return
    if (!confirm('Are you sure you want to delete this annotation?')) return

    try {
      const response = await fetch(`/api/annotations/${annotationId}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        await fetchAnnotations()
      } else {
        toast.error('Failed to delete annotation')
        console.error('Failed to delete annotation')
      }
    } catch (error) {
      toast.error('Failed to delete annotation')
      console.error('Error deleting annotation:', error)
    }
  }

  const addNewQuickOption = async () => {
    if (!newOptionText.trim()) return

    try {
      const response = await fetch('/api/annotation-quick-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          option_text: newOptionText.trim(),
          group_name: newOptionGroup || null
        })
      })

      if (response.ok) {
        setNewOptionText('')
        setNewOptionGroup('')
        await refetchOptions()
      } else {
        const errorData = await response.json()
        if (response.status === 409) {
          alert('This option already exists')
        } else {
          console.error('Failed to add quick option:', errorData)
        }
      }
    } catch (error) {
      console.error('Error adding quick option:', error)
    }
  }

  const addNewGroup = async () => {
    if (!newGroupName.trim()) return

    try {
      const response = await fetch('/api/annotation-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_name: newGroupName.trim()
        })
      })

      if (response.ok) {
        setNewGroupName('')
        setShowNewGroupForm(false)
        await refetchGroups()
      } else {
        const errorData = await response.json()
        if (response.status === 409) {
          alert('A group with this name already exists')
        } else {
          console.error('Failed to add group:', errorData)
        }
      }
    } catch (error) {
      console.error('Error adding group:', error)
    }
  }

  const toggleGroup = (groupName: string) => {
    setCollapsedGroups(prev => {
      const newSet = new Set(prev)
      if (newSet.has(groupName)) {
        newSet.delete(groupName)
      } else {
        newSet.add(groupName)
      }
      return newSet
    })
  }

  const handleDragStart = (event: DragStartEvent) => {
    const optionData = event.active.data.current?.option as AnnotationQuickOption | undefined
    if (optionData) {
      setIsDraggingOption(true)
    }
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    setIsDraggingOption(false)

    if (!over) return

    // Extract option information
    const optionData = active.data.current?.option as AnnotationQuickOption | undefined
    if (!optionData) return

    // Check if dropping into delete zone
    const isDeleteZone = over.data.current?.isDeleteZone as boolean | undefined
    if (isDeleteZone) {
      setDeleteOptionModal({ optionId: optionData.option_id, optionText: optionData.option_text })
      return
    }

    // Otherwise, handle group reassignment
    const targetGroupName = over.data.current?.groupName as string | undefined
    if (!targetGroupName) return

    // Check if we're dropping into a different group
    const newGroupName = targetGroupName === 'Ungrouped' ? null : targetGroupName
    if (optionData.group_name === newGroupName) return

    try {
      const response = await fetch(`/api/annotation-quick-options/${optionData.option_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_name: newGroupName })
      })

      if (response.ok) {
        await refetchOptions()
      } else {
        console.error('Failed to update option group')
        alert('Failed to reassign option to new group')
      }
    } catch (error) {
      console.error('Error updating option group:', error)
      alert('Error reassigning option to new group')
    }
  }

  const deleteGroup = async (groupId: number, groupName: string) => {
    if (!confirm(`Are you sure you want to delete the group "${groupName}"?\n\nThis will only work if the group is empty.`)) {
      return
    }

    try {
      const response = await fetch(`/api/annotation-groups/${groupId}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        await refetchGroups()
      } else {
        const errorData = await response.json()
        if (response.status === 409) {
          alert(errorData.message || 'Cannot delete group with existing options')
        } else {
          alert('Failed to delete group')
        }
      }
    } catch (error) {
      console.error('Error deleting group:', error)
      alert('Error deleting group')
    }
  }

  const handleDeleteOptionConfirmed = async () => {
    setDeleteOptionModal(null)
    await Promise.all([refetchOptions(), fetchAnnotations()])
  }

  // Group options by group_name
  const groupedOptions = quickOptions.reduce((acc, option) => {
    const key = option.group_name || 'Ungrouped'
    if (!acc[key]) {
      acc[key] = []
    }
    acc[key].push(option)
    return acc
  }, {} as Record<string, AnnotationQuickOption[]>)

  const ungroupedColor = resolvedTheme === 'dark' ? '#6b7280' : '#9ca3af'
  const isFailedEmpty =
    !annotationsLoading &&
    annotations.length === 0 &&
    overallStatus === 'FAIL'

  const startEdit = (annotation: Annotation) => {
    if (annotation.pending) return
    setEditingId(annotation.annotation_id)
    setEditText(annotation.annotation_text)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditText('')
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <Card className="flex h-full w-full flex-col gap-3 py-4">
        <CardHeader className="px-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4" />
            Annotations
            {!annotationsLoading && annotations.length > 0 && (
              <Badge variant="secondary" className="tabular-nums">{annotations.length}</Badge>
            )}
          </CardTitle>
          <div className="text-xs text-muted-foreground">
            S/N: {serialNumber}
          </div>
        </CardHeader>

        <CardContent className="flex-1 space-y-5 overflow-y-auto px-4">
          {/* Existing annotations — the primary content */}
          <div className="space-y-2">
            {annotationsLoading ? (
              <div className="py-4 text-center text-sm text-muted-foreground">
                Loading annotations...
              </div>
            ) : annotations.length === 0 ? (
              isFailedEmpty ? (
                <div className="rounded-lg border border-dashed border-rose-300 bg-rose-50/60 px-3 py-5 text-center dark:border-rose-800 dark:bg-rose-950/20">
                  <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">
                    Tag this failure
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    This test failed with no annotations yet. Use the quick options below to categorize the root cause.
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed px-3 py-5 text-center text-sm text-muted-foreground">
                  No annotations yet.
                  <br />
                  Use the options below to add one.
                </div>
              )
            ) : (
              annotations.map((annotation) => (
                <div
                  key={annotation.annotation_id}
                  className={`group/annotation rounded-lg border bg-card p-2.5 ${
                    annotation.pending ? 'opacity-70' : ''
                  }`}
                  style={{
                    borderLeftWidth: 3,
                    borderLeftColor: annotation.group_color ?? 'var(--border)',
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Badge
                        variant={annotation.annotation_type === 'failure_cause' ? 'destructive' : 'secondary'}
                        className="text-xs"
                      >
                        {annotation.annotation_type === 'failure_cause' ? 'Failure' : 'Note'}
                      </Badge>
                      {annotation.group_name && (
                        <span className="truncate text-xs text-muted-foreground">{annotation.group_name}</span>
                      )}
                      {annotation.pending && (
                        <span className="text-xs italic text-muted-foreground">Saving…</span>
                      )}
                    </div>
                    {!annotation.pending && (
                      <div className="flex gap-0.5 opacity-0 transition-opacity group-hover/annotation:opacity-100 focus-within:opacity-100">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => startEdit(annotation)}
                          className="h-7 w-7 p-0"
                          title="Edit annotation"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteAnnotation(annotation.annotation_id)}
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          title="Delete annotation"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>

                  {editingId === annotation.annotation_id ? (
                    <div className="mt-2 space-y-2">
                      <Textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="min-h-12 text-xs"
                      />
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          onClick={() => updateAnnotation(annotation.annotation_id, editText)}
                          disabled={!editText.trim()}
                          className="h-7 flex-1 text-xs"
                        >
                          <Check className="mr-1 h-3 w-3" />
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={cancelEdit}
                          className="h-7 flex-1 text-xs"
                        >
                          <X className="mr-1 h-3 w-3" />
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1.5">
                      <p className="text-sm leading-snug">{annotation.annotation_text}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
                        <span
                          className="font-medium text-foreground/80"
                          title={annotation.author_email || undefined}
                        >
                          {annotation.created_by || 'Unknown'}
                        </span>
                        <span aria-hidden>·</span>
                        <span title={formatInTimezone(annotation.created_at)}>
                          {formatRelativeTime(annotation.created_at)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Quick annotate */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Quick annotate
            </h4>

            {groups.map((group) => {
              const groupOptions = groupedOptions[group.group_name] || []
              const isCollapsed = collapsedGroups.has(group.group_name)

              return (
                <DroppableGroup
                  key={group.group_id}
                  groupName={group.group_name}
                  color={group.group_color}
                  optionCount={groupOptions.length}
                  isCollapsed={isCollapsed}
                  onToggle={() => toggleGroup(group.group_name)}
                  onDelete={() => deleteGroup(group.group_id, group.group_name)}
                >
                  {groupOptions.map((option) => (
                    <DraggableQuickOption
                      key={option.option_id}
                      option={option}
                      accentColor={group.group_color}
                      onClick={() =>
                        addQuickAnnotation(
                          option.option_text,
                          group.group_name,
                          group.group_color
                        )
                      }
                    />
                  ))}
                  {groupOptions.length === 0 && (
                    <div className="text-xs italic text-muted-foreground">No options in this group</div>
                  )}
                </DroppableGroup>
              )
            })}

            {/* Ungrouped options */}
            {groupedOptions['Ungrouped'] && groupedOptions['Ungrouped'].length > 0 && (
              <DroppableGroup
                groupName="Ungrouped"
                color={ungroupedColor}
                optionCount={groupedOptions['Ungrouped'].length}
                isCollapsed={collapsedGroups.has('Ungrouped')}
                onToggle={() => toggleGroup('Ungrouped')}
              >
                {groupedOptions['Ungrouped'].map((option) => (
                  <DraggableQuickOption
                    key={option.option_id}
                    option={option}
                    onClick={() => addQuickAnnotation(option.option_text, null, null)}
                  />
                ))}
              </DroppableGroup>
            )}

            {/* Delete Zone - appears during drag at bottom */}
            <DeleteZone isDragging={isDraggingOption} />
          </div>

          {/* Custom Annotation Form */}
          <div className="space-y-2">
            {!showCustomForm ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowCustomForm(true)}
                className="h-8 w-full text-xs"
              >
                <Plus className="mr-1 h-3 w-3" />
                Add Custom Note
              </Button>
            ) : (
              <div className="space-y-2">
                <Textarea
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  placeholder="Enter custom annotation..."
                  className="min-h-16 text-xs"
                />
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    onClick={addCustomAnnotation}
                    disabled={!customText.trim()}
                    className="h-7 flex-1 text-xs"
                  >
                    <Check className="mr-1 h-3 w-3" />
                    Add
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setShowCustomForm(false)
                      setCustomText('')
                    }}
                    className="h-7 flex-1 text-xs"
                  >
                    <X className="mr-1 h-3 w-3" />
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Vocabulary management — collapsed by default to keep the panel focused */}
          <div className="border-t pt-3">
            <button
              onClick={() => setManageOpen(!manageOpen)}
              className="flex w-full items-center gap-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Settings2 className="h-3.5 w-3.5" />
              Manage groups & options
              {manageOpen
                ? <ChevronDown className="ml-auto h-3.5 w-3.5" />
                : <ChevronRight className="ml-auto h-3.5 w-3.5" />}
            </button>

            {manageOpen && (
              <div className="mt-3 space-y-3">
                {/* Add new group */}
                {!showNewGroupForm ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowNewGroupForm(true)}
                    className="h-7 w-full text-xs"
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    New Group
                  </Button>
                ) : (
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      placeholder="Group name..."
                      className="h-7 flex-1 rounded border border-input bg-background px-2 text-xs"
                      onKeyPress={(e) => e.key === 'Enter' && addNewGroup()}
                    />
                    <Button
                      size="sm"
                      onClick={addNewGroup}
                      disabled={!newGroupName.trim()}
                      className="h-7 px-2"
                    >
                      <Check className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setShowNewGroupForm(false)
                        setNewGroupName('')
                      }}
                      className="h-7 px-2"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                )}

                {/* Add new quick option */}
                <div className="space-y-1">
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={newOptionText}
                      onChange={(e) => setNewOptionText(e.target.value)}
                      placeholder="New quick option..."
                      className="h-7 flex-1 rounded border border-input bg-background px-2 text-xs"
                      onKeyPress={(e) => e.key === 'Enter' && addNewQuickOption()}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={addNewQuickOption}
                      disabled={!newOptionText.trim()}
                      className="h-7 px-2"
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                  <select
                    value={newOptionGroup}
                    onChange={(e) => setNewOptionGroup(e.target.value)}
                    className="h-7 w-full rounded border border-input bg-background px-2 text-xs text-foreground"
                  >
                    <option value="">No group</option>
                    {groups.map((group) => (
                      <option key={group.group_id} value={group.group_name}>
                        {group.group_name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Tip: drag an option by its grip to move it between groups or delete it.
                  </p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Delete Option Modal */}
      {deleteOptionModal && (
        <DeleteOptionModal
          optionId={deleteOptionModal.optionId}
          optionText={deleteOptionModal.optionText}
          onClose={() => setDeleteOptionModal(null)}
          onConfirm={handleDeleteOptionConfirmed}
        />
      )}
    </DndContext>
  )
}
