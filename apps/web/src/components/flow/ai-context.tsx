'use client'

import { createContext, useContext } from 'react'

/** A saved AI endpoint as the editor needs it - enough to pick one by name. */
export interface AiEndpointOption {
  id: string
  name: string
}

const AiEndpointsContext = createContext<AiEndpointOption[]>([])

export const AiEndpointsProvider = AiEndpointsContext.Provider

export function useAiEndpoints() {
  return useContext(AiEndpointsContext)
}
