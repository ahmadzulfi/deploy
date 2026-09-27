'use client'

import { createContext, useContext } from 'react'

/** A synced template as the editor needs it - enough to pick and fill one. */
export interface TemplateOption {
  name: string
  language: string
  category: string
  status: string
  components: unknown
}

const TemplatesContext = createContext<TemplateOption[]>([])

export const TemplatesProvider = TemplatesContext.Provider

export function useTemplates() {
  return useContext(TemplatesContext)
}
