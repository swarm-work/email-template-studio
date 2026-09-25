/**
 * Workspace settings: the general settings and the named members.
 *
 * Presentation layer. Editors see everything read-only with a sentence saying
 * why; admins can change it. The server decides too (403), so this gating is
 * a courtesy, not the security boundary.
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { WorkspacePatch } from '@/application/repositories/workspaceRepository'
import type { WorkspaceMember, WorkspaceRole } from '@/domain'
import { useWorkspace } from './WorkspaceContext'

export function WorkspaceSettingsPage() {
  const { workspace } = useWorkspace()
  const admin = workspace.role === 'admin'

  return (
    <div className="mx-auto w-full max-w-[960px] space-y-6 px-6 py-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Workspace settings</h1>
        <p className="text-muted-foreground text-sm">
          <span className="font-mono">{workspace.slug}</span> · you are{' '}
          {workspace.role === 'admin' ? 'an admin' : 'an editor'}
        </p>
      </header>

      {!admin ? (
        <Alert>
          <AlertTitle>Read only</AlertTitle>
          <AlertDescription>
            Only a workspace admin can change these settings or its members.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Keyed by the slug: a switch to another workspace remounts both, so the
          form starts from that workspace's values instead of syncing to them. */}
      <GeneralSettings key={workspace.slug} admin={admin} />
      <MembersSection key={workspace.slug} admin={admin} />
    </div>
  )
}

/** The settings row by row. Saved as one PATCH of the fields that changed. */
function GeneralSettings({ admin }: { admin: boolean }) {
  const { workspace, repository, replace } = useWorkspace()
  const [name, setName] = useState(workspace.name)
  const [defaultFrom, setDefaultFrom] = useState(workspace.defaultFrom)
  const [allowedFromDomain, setAllowedFromDomain] = useState(workspace.allowedFromDomain)
  const [organization, setOrganization] = useState(workspace.stytchOrganizationSlug ?? '')
  const [configurationSet, setConfigurationSet] = useState(workspace.sesConfigurationSet ?? '')
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  /** Only what differs from the saved workspace travels; '' on a nullable field means "clear". */
  function changes(): WorkspacePatch {
    const patch: Record<string, unknown> = {}
    if (name.trim() !== workspace.name) patch.name = name.trim()
    if (defaultFrom.trim() !== workspace.defaultFrom) patch.defaultFrom = defaultFrom.trim()
    if (allowedFromDomain.trim() !== workspace.allowedFromDomain)
      patch.allowedFromDomain = allowedFromDomain.trim()
    const org = organization.trim() === '' ? null : organization.trim()
    if (org !== workspace.stytchOrganizationSlug) patch.stytchOrganizationSlug = org
    const set = configurationSet.trim() === '' ? null : configurationSet.trim()
    if (set !== workspace.sesConfigurationSet) patch.sesConfigurationSet = set
    return patch as WorkspacePatch
  }

  const dirty = Object.keys(changes()).length > 0

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (saving || !dirty) return
    setSaving(true)
    setProblem(null)
    try {
      const result = await repository.update(workspace.slug, changes())
      if (!result.ok) {
        setProblem(result.failure.message)
        return
      }
      replace(result.value)
      toast.success('Workspace settings saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>General</CardTitle>
        <CardDescription>Who may enter, and how this workspace sends.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-4">
          <Field id="ws-name" label="Name" value={name} onChange={setName} disabled={!admin} />
          <Field
            id="ws-from"
            label="Default sender"
            type="email"
            value={defaultFrom}
            onChange={setDefaultFrom}
            disabled={!admin}
            hint="Used when a send names no sender."
          />
          <Field
            id="ws-domain"
            label="Sending domain"
            value={allowedFromDomain}
            onChange={setAllowedFromDomain}
            disabled={!admin}
            hint="Sends from this workspace may only come from this domain."
          />
          <Field
            id="ws-org"
            label="Stytch organisation"
            value={organization}
            onChange={setOrganization}
            disabled={!admin}
            hint="Everyone in this organisation is an admin here. Leave empty to admit named members only."
          />
          <Field
            id="ws-config-set"
            label="SES configuration set"
            value={configurationSet}
            onChange={setConfigurationSet}
            disabled={!admin}
            hint="Where SES reports this workspace's events. Empty means the server-wide default."
          />

          {problem ? (
            <Alert variant="destructive">
              <AlertDescription>{problem}</AlertDescription>
            </Alert>
          ) : null}

          {admin ? (
            <div className="flex justify-end">
              <Button type="submit" disabled={saving || !dirty}>
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  )
}

interface FieldProps {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly disabled: boolean
  readonly type?: string
  readonly hint?: string
}

function Field({ id, label, value, onChange, disabled, type = 'text', hint }: FieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  )
}

/** The named members: list, add, change role, remove. Organisation members are not rows. */
function MembersSection({ admin }: { admin: boolean }) {
  const { workspace, repository } = useWorkspace()
  const [members, setMembers] = useState<readonly WorkspaceMember[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<WorkspaceRole>('editor')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const result = await repository.listMembers(workspace.slug)
    if (result.ok) {
      setMembers(result.value)
      setProblem(null)
    } else {
      setMembers([])
      // An editor is not allowed to see the list; that is not a problem worth a red box.
      setProblem(result.failure.code === 'forbidden' ? null : result.failure.message)
    }
  }, [repository, workspace.slug])

  useEffect(() => {
    if (!admin) return
    void load()
  }, [admin, load])

  async function add(event: React.FormEvent) {
    event.preventDefault()
    if (busy || email.trim() === '') return
    setBusy(true)
    try {
      const result = await repository.putMember(workspace.slug, email.trim(), role)
      if (!result.ok) {
        toast.error(result.failure.message)
        return
      }
      setEmail('')
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function changeRole(member: WorkspaceMember, next: WorkspaceRole) {
    const result = await repository.putMember(workspace.slug, member.email, next)
    if (!result.ok) toast.error(result.failure.message)
    await load()
  }

  async function remove(member: WorkspaceMember) {
    const result = await repository.removeMember(workspace.slug, member.email)
    if (!result.ok) toast.error(result.failure.message)
    await load()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>
          {workspace.stytchOrganizationSlug
            ? `Everyone in the ${workspace.stytchOrganizationSlug} organisation is an admin. The people below are named on top of that.`
            : 'This workspace admits named members only.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!admin ? (
          <p className="text-muted-foreground text-sm">Only an admin can see or change the member list.</p>
        ) : null}

        {problem ? (
          <Alert variant="destructive">
            <AlertDescription>{problem}</AlertDescription>
          </Alert>
        ) : null}

        {admin && members ? (
          members.length === 0 ? (
            <p className="text-muted-foreground text-sm">No named members yet.</p>
          ) : (
            <ul className="divide-y rounded-md border" aria-label="Named members">
              {members.map((member) => (
                <li key={member.email} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{member.email}</span>
                  <Select
                    value={member.role}
                    onValueChange={(next) => void changeRole(member, next as WorkspaceRole)}
                  >
                    <SelectTrigger size="sm" className="w-28" aria-label={`Role of ${member.email}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">admin</SelectItem>
                      <SelectItem value="editor">editor</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="sm" onClick={() => void remove(member)}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {admin ? (
          <form onSubmit={add} className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1 space-y-2">
              <Label htmlFor="member-email">Add a member</Label>
              <Input
                id="member-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="person@example.com"
              />
            </div>
            <Select value={role} onValueChange={(next) => setRole(next as WorkspaceRole)}>
              <SelectTrigger className="w-28" aria-label="Role for the new member">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">admin</SelectItem>
                <SelectItem value="editor">editor</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" disabled={busy || email.trim() === ''}>
              Add
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  )
}
