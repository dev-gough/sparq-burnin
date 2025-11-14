'use client';

import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';

export interface AnnotationQuickOption {
  option_id: number;
  option_text: string;
  group_name: string | null;
  group_color: string | null;
  display_order: number;
  is_active: boolean;
  created_at: string;
}

export interface AnnotationGroup {
  group_id: number;
  group_name: string;
  group_color: string;
  display_order: number;
  created_at: string;
}

interface AnnotationCacheContextType {
  quickOptions: AnnotationQuickOption[];
  groups: AnnotationGroup[];
  isLoading: boolean;
  refetchOptions: () => Promise<void>;
  refetchGroups: () => Promise<void>;
}

const AnnotationCacheContext = createContext<AnnotationCacheContextType | null>(null);

export function AnnotationCacheProvider({ children }: { children: ReactNode }) {
  const [quickOptions, setQuickOptions] = useState<AnnotationQuickOption[]>([]);
  const [groups, setGroups] = useState<AnnotationGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchOptions = useCallback(async () => {
    try {
      const response = await fetch('/api/annotation-quick-options');
      if (response.ok) {
        const data = await response.json();
        setQuickOptions(data);
      }
    } catch (error) {
      console.error('Failed to fetch annotation quick options:', error);
    }
  }, []);

  const fetchGroups = useCallback(async () => {
    try {
      const response = await fetch('/api/annotation-groups');
      if (response.ok) {
        const data = await response.json();
        setGroups(data);
      }
    } catch (error) {
      console.error('Failed to fetch annotation groups:', error);
    }
  }, []);

  const refetchOptions = useCallback(async () => {
    await fetchOptions();
  }, [fetchOptions]);

  const refetchGroups = useCallback(async () => {
    await fetchGroups();
  }, [fetchGroups]);

  // Initial load
  useEffect(() => {
    const loadAll = async () => {
      setIsLoading(true);
      await Promise.all([fetchOptions(), fetchGroups()]);
      setIsLoading(false);
    };
    loadAll();
  }, [fetchOptions, fetchGroups]);

  return (
    <AnnotationCacheContext.Provider
      value={{
        quickOptions,
        groups,
        isLoading,
        refetchOptions,
        refetchGroups,
      }}
    >
      {children}
    </AnnotationCacheContext.Provider>
  );
}

export function useAnnotationCache() {
  const context = useContext(AnnotationCacheContext);
  if (!context) {
    throw new Error('useAnnotationCache must be used within AnnotationCacheProvider');
  }
  return context;
}
