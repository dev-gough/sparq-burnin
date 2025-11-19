"use client"

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, X } from 'lucide-react'
import { useTimezone } from '@/contexts/TimezoneContext'

interface AffectedTest {
  test_id: number
  serial_number: string
  start_time: string
  overall_status: string
}

interface DeleteOptionModalProps {
  optionId: number
  optionText: string
  onClose: () => void
  onConfirm: () => void
}

export default function DeleteOptionModal({
  optionId,
  optionText,
  onClose,
  onConfirm
}: DeleteOptionModalProps) {
  const [loading, setLoading] = useState(true)
  const [affectedTests, setAffectedTests] = useState<AffectedTest[]>([])
  const [affectedCount, setAffectedCount] = useState(0)
  const [deleting, setDeleting] = useState(false)
  const { formatInTimezone } = useTimezone()

  useEffect(() => {
    const fetchAffectedTests = async () => {
      try {
        const response = await fetch(`/api/annotation-quick-options/${optionId}`)
        if (response.ok) {
          const data = await response.json()
          setAffectedTests(data.affected_tests)
          setAffectedCount(data.affected_count)
        }
      } catch (error) {
        console.error('Failed to fetch affected tests:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchAffectedTests()
  }, [optionId])

  // Handle ESC key to close modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  const handleConfirm = async () => {
    setDeleting(true)
    try {
      const response = await fetch(`/api/annotation-quick-options/${optionId}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        onConfirm()
      } else {
        alert('Failed to delete quick option')
      }
    } catch (error) {
      console.error('Error deleting quick option:', error)
      alert('Error deleting quick option')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-background rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-6 w-6 text-destructive flex-shrink-0 mt-1" />
            <div>
              <h2 className="text-xl font-bold text-destructive">Delete Quick Annotation Option</h2>
              <p className="text-sm text-muted-foreground mt-1">
                This action cannot be undone
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 p-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="bg-destructive/10 dark:bg-destructive/20 border border-destructive/30 rounded-lg p-4">
            <p className="font-medium">
              You are about to delete: <span className="font-bold">&quot;{optionText}&quot;</span>
            </p>
          </div>

          {loading ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">Loading affected tests...</p>
            </div>
          ) : affectedCount === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">
                No tests are currently using this annotation.
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                The quick option will be deleted without affecting any test data.
              </p>
            </div>
          ) : (
            <>
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                <p className="font-medium text-yellow-900 dark:text-yellow-200">
                  Warning: This will delete {affectedCount} annotation{affectedCount !== 1 ? 's' : ''} from the following test{affectedCount !== 1 ? 's' : ''}:
                </p>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        <th className="text-left p-3 font-medium">Test ID</th>
                        <th className="text-left p-3 font-medium">Serial Number</th>
                        <th className="text-left p-3 font-medium">Start Time</th>
                        <th className="text-left p-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {affectedTests.map((test) => (
                        <tr key={test.test_id} className="border-t hover:bg-muted/50 cursor-pointer" onClick={() => window.open(`/test/${test.test_id}`, '_blank')}>
                          <td className="p-3">
                            <span className="text-blue-600 dark:text-blue-400">
                              {test.test_id}
                            </span>
                          </td>
                          <td className="p-3 font-mono text-xs">{test.serial_number}</td>
                          <td className="p-3">{formatInTimezone(test.start_time)}</td>
                          <td className="p-3">
                            <Badge
                              variant={
                                test.overall_status === 'PASS' ? 'default' :
                                test.overall_status === 'FAIL' ? 'destructive' :
                                'secondary'
                              }
                            >
                              {test.overall_status}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t bg-muted/20">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={deleting}
            className="cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={deleting || loading}
            className="cursor-pointer"
          >
            {deleting ? 'Deleting...' : `Delete ${affectedCount > 0 ? `and Remove ${affectedCount} Annotation${affectedCount !== 1 ? 's' : ''}` : 'Option'}`}
          </Button>
        </div>
      </div>
    </div>
  )
}
