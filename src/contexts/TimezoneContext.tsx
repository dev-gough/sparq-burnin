"use client"

import React, { createContext, useContext, useState, useEffect } from 'react'

export type TimezoneOption = 'local' | 'utc' | 'delhi'

interface TimezoneContextType {
  selectedTimezone: TimezoneOption
  setTimezone: (timezone: TimezoneOption) => void
  formatInTimezone: (utcDateString: string) => string
  formatDateInTimezone: (utcDateString: string) => string
  formatTimeInTimezone: (utcDateString: string) => string
}

const TimezoneContext = createContext<TimezoneContextType | undefined>(undefined)

export const timezoneOptions = [
  { 
    value: 'local' as const, 
    label: 'Local Time', 
    description: 'Your browser timezone' 
  },
  { 
    value: 'delhi' as const, 
    label: 'Delhi Time', 
    description: 'Asia/Kolkata (IST)' 
  },
  { 
    value: 'utc' as const, 
    label: 'UTC', 
    description: 'Coordinated Universal Time' 
  }
]

const TIMEZONE_COOKIE_KEY = 'burnin-selected-timezone'

export function TimezoneProvider({ children }: { children: React.ReactNode }) {
  const [selectedTimezone, setSelectedTimezone] = useState<TimezoneOption>('local')

  // Load timezone from cookie on mount
  useEffect(() => {
    try {
      const cookies = document.cookie.split(';')
      const timezoneCookie = cookies.find(cookie => 
        cookie.trim().startsWith(`${TIMEZONE_COOKIE_KEY}=`)
      )
      
      if (timezoneCookie) {
        const value = timezoneCookie.split('=')[1] as TimezoneOption
        if (['local', 'utc', 'delhi'].includes(value)) {
          setSelectedTimezone(value)
        }
      }
    } catch (error) {
      console.warn('Failed to load timezone from cookie:', error)
    }
  }, [])

  const setTimezone = (timezone: TimezoneOption) => {
    setSelectedTimezone(timezone)
    
    // Save to cookie
    try {
      document.cookie = `${TIMEZONE_COOKIE_KEY}=${timezone}; path=/; max-age=${60 * 60 * 24 * 365}` // 1 year
    } catch (error) {
      console.warn('Failed to save timezone to cookie:', error)
    }
  }

  const getTimezoneConfig = (timezone: TimezoneOption) => {
    switch (timezone) {
      case 'utc':
        return { timeZone: 'UTC' }
      case 'delhi':
        return { timeZone: 'Asia/Kolkata' }
      case 'local':
      default:
        return {} // Use browser default
    }
  }

  const formatInTimezone = (utcDateString: string): string => {
    // Ensure we're working with a proper UTC date
    let date: Date
    if (utcDateString.endsWith('Z')) {
      // Already has UTC marker
      date = new Date(utcDateString)
    } else {
      // Add UTC marker to ensure proper parsing
      date = new Date(utcDateString + (utcDateString.includes('T') ? 'Z' : 'T00:00:00Z'))
    }
    
    const config = getTimezoneConfig(selectedTimezone)
    
    return date.toLocaleString('en-US', {
      ...config,
      month: 'numeric',
      day: 'numeric', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short'
    })
  }

  const formatDateInTimezone = (utcDateString: string): string => {
    // Ensure we're working with a proper UTC date
    let date: Date
    if (utcDateString.endsWith('Z')) {
      date = new Date(utcDateString)
    } else {
      date = new Date(utcDateString + (utcDateString.includes('T') ? 'Z' : 'T00:00:00Z'))
    }
    
    const config = getTimezoneConfig(selectedTimezone)
    
    return date.toLocaleDateString('en-US', {
      ...config,
      month: 'numeric',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const formatTimeInTimezone = (utcDateString: string): string => {
    // Ensure we're working with a proper UTC date
    let date: Date
    if (utcDateString.endsWith('Z')) {
      date = new Date(utcDateString)
    } else {
      date = new Date(utcDateString + (utcDateString.includes('T') ? 'Z' : 'T00:00:00Z'))
    }
    
    const config = getTimezoneConfig(selectedTimezone)
    
    return date.toLocaleTimeString('en-US', {
      ...config,
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short'
    })
  }

  return (
    <TimezoneContext.Provider value={{
      selectedTimezone,
      setTimezone,
      formatInTimezone,
      formatDateInTimezone,
      formatTimeInTimezone
    }}>
      {children}
    </TimezoneContext.Provider>
  )
}

export function useTimezone() {
  const context = useContext(TimezoneContext)
  if (context === undefined) {
    throw new Error('useTimezone must be used within a TimezoneProvider')
  }
  return context
}