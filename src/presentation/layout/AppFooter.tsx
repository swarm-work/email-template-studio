import { StatusDot } from '@/presentation/shared/StatusBadge'

export interface AppFooterProps {
  environment: string
  version: string
  providerLabel: string
}

export function AppFooter({ environment, version, providerLabel }: AppFooterProps) {
  return (
    <footer className="bg-card mt-8 shrink-0 border-t">
      <div className="text-muted-foreground mx-auto flex h-9 max-w-[1440px] items-center gap-4 px-6 text-xs">
        <span className="flex items-center gap-1.5">
          <StatusDot tone="success" />
          {environment} environment
        </span>
        <span className="font-mono">v{version}</span>
        <span className="hidden sm:inline">Provider: {providerLabel}</span>
        <span className="ml-auto">
          Test sends go through the local send server only. The browser never holds credentials.
        </span>
      </div>
    </footer>
  )
}
