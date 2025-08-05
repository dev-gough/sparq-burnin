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
  created_by?: string
  created_at: string
  updated_at: string
  current_test_id?: number
}

interface QuickOption {
  option_id: number
  option_text: string
  display_order: number
  is_active: boolean
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
  const [loading, setLoading] = useState(true)
  const [showCustomForm, setShowCustomForm] = useState(false)
  const [customText, setCustomText] = useState('')
  const [newOptionText, setNewOptionText] = useState('')
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

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      await Promise.all([fetchAnnotations(), fetchQuickOptions()])
      setLoading(false)
    }
    loadData()
  }, [fetchAnnotations, fetchQuickOptions])

  const addQuickAnnotation = async (optionText: string) => {
    try {
      const response = await fetch(`/api/test/${testId}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          annotation_type: 'failure_cause',
          annotation_text: optionText,
          created_by: 'User'
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
          annotation_text: customText.trim(),
          created_by: 'User'
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
          annotation_text: newText.trim(),
          created_by: 'User'
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
          option_text: newOptionText.trim()
        })
      })

      if (response.ok) {
        setNewOptionText('')
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
        {/* Quick Annotate Section */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Quick Annotate:</h4>
          <div className="flex flex-wrap gap-1">
            {quickOptions.map((option) => (
              <Button
                key={option.option_id}
                size="sm"
                variant="outline"
                onClick={() => addQuickAnnotation(option.option_text)}
                className="h-7 px-2 text-xs"
              >
                {option.option_text}
              </Button>
            ))}
          </div>
          
          {/* Add new quick option */}
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
              {annotations.map((annotation) => (
                <div key={annotation.annotation_id} className="border rounded p-2 space-y-2">
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
                        {annotation.created_by} • {formatInTimezone(annotation.created_at)}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}