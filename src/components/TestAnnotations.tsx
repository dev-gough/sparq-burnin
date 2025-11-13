"use client"

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Plus, MessageSquare, Edit2, Trash2, Check, X } from 'lucide-react'
import { useTimezone } from '@/contexts/TimezoneContext'

interface Annotation {
  annotation_id: number
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
}

interface QuickOption {
  option_id: number
  option_text: string
  group_name: string | null
  group_color: string | null
  display_order: number
  is_active: boolean
  created_at: string
}

interface AnnotationGroup {
  group_id: number
  group_name: string
  group_color: string
  display_order: number
  created_at: string
}

interface TestAnnotationsProps {
  testId: number
  serialNumber: string
  startTime: string
}

export default function TestAnnotations({ testId, serialNumber }: TestAnnotationsProps) {
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [quickOptions, setQuickOptions] = useState<QuickOption[]>([])
  const [groups, setGroups] = useState<AnnotationGroup[]>([])
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [showCustomForm, setShowCustomForm] = useState(false)
  const [customText, setCustomText] = useState('')
  const [newOptionText, setNewOptionText] = useState('')
  const [newOptionGroup, setNewOptionGroup] = useState<string>('')
  const [showNewGroupForm, setShowNewGroupForm] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const { formatInTimezone } = useTimezone()

  const fetchAnnotations = useCallback(async () => {
    try {
      const response = await fetch(`/api/test/${testId}/annotations`)
      if (response.ok) {
        const data = await response.json()
        setAnnotations(data)
      }
    } catch (error) {
      console.error('Failed to fetch annotations:', error)
    }
  }, [testId])

  const fetchQuickOptions = useCallback(async () => {
    try {
      const response = await fetch('/api/annotation-quick-options')
      if (response.ok) {
        const data = await response.json()
        setQuickOptions(data)
      }
    } catch (error) {
      console.error('Failed to fetch quick options:', error)
    }
  }, [])

  const fetchGroups = useCallback(async () => {
    try {
      const response = await fetch('/api/annotation-groups')
      if (response.ok) {
        const data = await response.json()
        setGroups(data)
      }
    } catch (error) {
      console.error('Failed to fetch groups:', error)
    }
  }, [])

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      await Promise.all([fetchAnnotations(), fetchQuickOptions(), fetchGroups()])
      setLoading(false)
    }
    loadData()
  }, [fetchAnnotations, fetchQuickOptions, fetchGroups])

  const addQuickAnnotation = async (optionText: string) => {
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
        await fetchAnnotations()
      } else {
        console.error('Failed to add annotation')
      }
    } catch (error) {
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
        console.error('Failed to add custom annotation')
      }
    } catch (error) {
      console.error('Error adding custom annotation:', error)
    }
  }

  const updateAnnotation = async (annotationId: number, newText: string) => {
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
        console.error('Failed to update annotation')
      }
    } catch (error) {
      console.error('Error updating annotation:', error)
    }
  }

  const deleteAnnotation = async (annotationId: number) => {
    if (!confirm('Are you sure you want to delete this annotation?')) return

    try {
      const response = await fetch(`/api/annotations/${annotationId}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        await fetchAnnotations()
      } else {
        console.error('Failed to delete annotation')
      }
    } catch (error) {
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
        await fetchQuickOptions()
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
        await fetchGroups()
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

  const getLighterColor = (hexColor: string, amount: number = 0.7): string => {
    const hex = hexColor.replace('#', '')
    const r = parseInt(hex.substring(0, 2), 16)
    const g = parseInt(hex.substring(2, 4), 16)
    const b = parseInt(hex.substring(4, 6), 16)

    const newR = Math.round(r + (255 - r) * amount)
    const newG = Math.round(g + (255 - g) * amount)
    const newB = Math.round(b + (255 - b) * amount)

    return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`
  }

  // Group options by group_name
  const groupedOptions = quickOptions.reduce((acc, option) => {
    const key = option.group_name || 'Ungrouped'
    if (!acc[key]) {
      acc[key] = []
    }
    acc[key].push(option)
    return acc
  }, {} as Record<string, QuickOption[]>)

  const startEdit = (annotation: Annotation) => {
    setEditingId(annotation.annotation_id)
    setEditText(annotation.annotation_text)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditText('')
  }

  if (loading) {
    return (
      <Card className="w-80 h-full">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Test Annotations
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-sm text-muted-foreground py-8">
            Loading annotations...
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-80 h-full flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          Test Annotations
        </CardTitle>
        <div className="text-xs text-muted-foreground">
          S/N: {serialNumber}
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 space-y-4 overflow-y-auto">
        {/* Quick Annotate Section - Grouped */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Quick Annotate:</h4>

          {/* Render groups */}
          {groups.map((group) => {
            const groupOptions = groupedOptions[group.group_name] || []
            const isCollapsed = collapsedGroups.has(group.group_name)

            return (
              <div key={group.group_id} className="border rounded overflow-hidden">
                {/* Group Header */}
                <button
                  onClick={() => toggleGroup(group.group_name)}
                  className="w-full flex items-center justify-between px-2 py-1.5 text-xs font-medium hover:opacity-80 transition-opacity"
                  style={{ backgroundColor: group.group_color, color: 'white' }}
                >
                  <span>{group.group_name}</span>
                  <span className="text-xs">{isCollapsed ? '▶' : '▼'}</span>
                </button>

                {/* Group Options */}
                {!isCollapsed && (
                  <div className="p-2 flex flex-wrap gap-1" style={{ backgroundColor: getLighterColor(group.group_color) }}>
                    {groupOptions.map((option) => (
                      <Button
                        key={option.option_id}
                        size="sm"
                        variant="outline"
                        onClick={() => addQuickAnnotation(option.option_text)}
                        className="h-6 px-2 text-xs bg-white hover:bg-gray-50"
                      >
                        {option.option_text}
                      </Button>
                    ))}
                    {groupOptions.length === 0 && (
                      <div className="text-xs text-muted-foreground italic">No options in this group</div>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {/* Ungrouped options */}
          {groupedOptions['Ungrouped'] && groupedOptions['Ungrouped'].length > 0 && (
            <div className="border rounded overflow-hidden">
              <button
                onClick={() => toggleGroup('Ungrouped')}
                className="w-full flex items-center justify-between px-2 py-1.5 text-xs font-medium bg-gray-500 text-white hover:opacity-80 transition-opacity"
              >
                <span>Ungrouped</span>
                <span className="text-xs">{collapsedGroups.has('Ungrouped') ? '▶' : '▼'}</span>
              </button>

              {!collapsedGroups.has('Ungrouped') && (
                <div className="p-2 flex flex-wrap gap-1 bg-gray-50">
                  {groupedOptions['Ungrouped'].map((option) => (
                    <Button
                      key={option.option_id}
                      size="sm"
                      variant="outline"
                      onClick={() => addQuickAnnotation(option.option_text)}
                      className="h-6 px-2 text-xs bg-white hover:bg-gray-50"
                    >
                      {option.option_text}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Add new group button */}
          {!showNewGroupForm ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowNewGroupForm(true)}
              className="w-full h-7 text-xs"
            >
              <Plus className="h-3 w-3 mr-1" />
              New Group
            </Button>
          ) : (
            <div className="flex gap-1">
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Group name..."
                className="flex-1 h-7 px-2 text-xs border border-input rounded"
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
                className="flex-1 h-7 px-2 text-xs border border-input rounded"
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
              className="w-full h-7 px-2 text-xs border border-input rounded"
            >
              <option value="">No group</option>
              {groups.map((group) => (
                <option key={group.group_id} value={group.group_name}>
                  {group.group_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Custom Annotation Form */}
        <div className="space-y-2">
          {!showCustomForm ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowCustomForm(true)}
              className="w-full h-8 text-xs"
            >
              <Plus className="h-3 w-3 mr-1" />
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
                  className="flex-1 h-7 text-xs"
                >
                  <Check className="h-3 w-3 mr-1" />
                  Add
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowCustomForm(false)
                    setCustomText('')
                  }}
                  className="flex-1 h-7 text-xs"
                >
                  <X className="h-3 w-3 mr-1" />
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Existing Annotations */}
        <div className="space-y-3">
          {annotations.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-4">
              No annotations yet
            </div>
          ) : (
            <>
              <h4 className="text-sm font-medium">Annotations ({annotations.length}):</h4>
              {annotations.map((annotation) => {
                const backgroundColor = annotation.group_color
                  ? getLighterColor(annotation.group_color)
                  : undefined

                return (
                  <div
                    key={annotation.annotation_id}
                    className="border rounded p-2 space-y-2"
                    style={{ backgroundColor }}
                  >
                    <div className="flex items-center justify-between">
                      <Badge
                        variant={annotation.annotation_type === 'failure_cause' ? 'destructive' : 'secondary'}
                        className="text-xs"
                      >
                        {annotation.annotation_type === 'failure_cause' ? 'Failure' : 'Note'}
                      </Badge>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => startEdit(annotation)}
                          className="h-6 w-6 p-0"
                        >
                          <Edit2 className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteAnnotation(annotation.annotation_id)}
                          className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>

                    {editingId === annotation.annotation_id ? (
                      <div className="space-y-2">
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
                            className="flex-1 h-6 text-xs"
                          >
                            <Check className="h-3 w-3 mr-1" />
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={cancelEdit}
                            className="flex-1 h-6 text-xs"
                          >
                            <X className="h-3 w-3 mr-1" />
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <p className="text-xs">{annotation.annotation_text}</p>
                        <div className="text-xs text-muted-foreground mt-1">
                          <span title={annotation.author_email || undefined}>
                            {annotation.created_by}
                          </span>
                          {annotation.author_email && (
                            <span className="opacity-70"> ({annotation.author_email})</span>
                          )}
                          {' • '}
                          {formatInTimezone(annotation.created_at)}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}