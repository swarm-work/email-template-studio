import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { fileNameFor, type EmailTemplate, type PreviewDevice } from '@/domain'
import { StatusBadge } from '@/presentation/shared/StatusBadge'
import { DeviceToggle } from './DeviceToggle'

export interface PageHeaderProps {
  template: EmailTemplate
  device: PreviewDevice
  onDeviceChange: (device: PreviewDevice) => void
  onSendTest: () => void
  sourceDirty: boolean
}

export function PageHeader({ template, device, onDeviceChange, onSendTest, sourceDirty }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Templates &amp; Studio</h1>
          <StatusBadge tone="warning">MVP · local development</StatusBadge>
        </div>
        <p className="text-muted-foreground max-w-lg text-sm">
          Edit React Email templates, validate their preview data and check the rendered result. Editing and
          preview run in this browser; test sends go through the send server.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="bg-card text-muted-foreground flex h-7 items-center gap-2 rounded-md border px-2 font-mono text-xs">
          {fileNameFor(template.kind, template.metadata.slug)}
          <span className="text-border" aria-hidden="true">
            |
          </span>
          <span className="text-foreground">{template.metadata.version.label}</span>
          {sourceDirty ? <span className="text-warning-foreground">· modified</span> : null}
        </span>
        <DeviceToggle value={device} onChange={onDeviceChange} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="sm" onClick={onSendTest} aria-describedby="send-test-hint">
              <Lock className="text-muted-foreground" aria-hidden="true" />
              Send test email
            </Button>
          </TooltipTrigger>
          <TooltipContent id="send-test-hint">
            Sends the current preview through the send server.
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
