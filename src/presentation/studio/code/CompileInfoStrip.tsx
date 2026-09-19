/**
 * The thin line above the editor that says what the studio actually does to
 * the source.
 *
 * Presentation layer. Every claim here is checked against reality: the mock's
 * "TS errors: 0" is a promise the studio cannot keep, because sucrase strips
 * types without checking them, so it reads "Type checking: Planned" instead
 * (docs/DESIGN.md §"what we do not copy").
 */
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { StatusBadge } from '@/presentation/shared/StatusBadge'

const TYPE_CHECKING_TOOLTIP =
  'The studio compiles TSX with sucrase, which strips types without checking them. Run npm run typecheck for real diagnostics.'

export interface CompileInfoStripProps {
  /** True when the props JSON matches the template's contract. */
  propsValid: boolean
}

export function CompileInfoStrip({ propsValid }: CompileInfoStripProps) {
  return (
    <div className="bg-muted/50 text-muted-foreground flex min-w-0 [scrollbar-width:none] items-center gap-3 overflow-x-auto rounded-lg border px-3 py-1.5 text-[11px]">
      <span className="shrink-0">
        Props:{' '}
        <span className={propsValid ? 'text-success-foreground' : 'text-danger-foreground'}>
          {propsValid ? 'valid' : 'invalid'}
        </span>
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="shrink-0">
            <StatusBadge tone="planned">Type checking: Planned</StatusBadge>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{TYPE_CHECKING_TOOLTIP}</TooltipContent>
      </Tooltip>
      <span className="shrink-0">React Email {__REACT_EMAIL_VERSION__}</span>
      {/* The sandbox only resolves these two modules. It used to be said in the
          old source workspace's footer and nowhere else, so without this line
          the rule is only discoverable by hitting the "Import not allowed"
          error (see RenderErrorBanner). */}
      <span className="shrink-0 font-mono">Imports limited to react and @react-email/components</span>
      <span className="ml-auto hidden shrink-0 pl-3 lg:inline">
        Compiled with Sucrase — types are stripped, not checked
      </span>
    </div>
  )
}
