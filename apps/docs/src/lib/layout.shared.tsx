import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'
import { appName } from './shared'

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="flex items-center gap-2 text-[0.9rem] font-semibold tracking-tight">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[#1f7a4d] text-xs font-bold text-white">
            WA
          </span>
          {appName}
          <span className="rounded-md border px-1.5 py-0.5 text-[0.6rem] font-bold leading-none text-fd-muted-foreground">
            API v1
          </span>
        </span>
      ),
    },
  }
}
