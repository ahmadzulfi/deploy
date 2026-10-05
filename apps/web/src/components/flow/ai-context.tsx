'use client'

import { createContext, useContext } from 'react'

/** A saved AI endpoint as the editor needs it - enough to pick one by name. */
export interface AiEndpointOption {
  id: string
  name: string
  /** ANSWER endpoints serve Tanya AI, ROUTE endpoints serve Arahkan AI. */
  kind: 'ANSWER' | 'ROUTE'
}

const AiEndpointsContext = createContext<AiEndpointOption[]>([])

export const AiEndpointsProvider = AiEndpointsContext.Provider

/** The saved endpoints, or only those a node of `kind` may use. */
export function useAiEndpoints(kind?: AiEndpointOption['kind']) {
  const all = useContext(AiEndpointsContext)
  return kind ? all.filter((e) => e.kind === kind) : all
}
