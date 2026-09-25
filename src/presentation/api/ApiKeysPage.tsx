import { useState, type Dispatch, type SetStateAction } from 'react'
import { CheckCircle2, Copy, KeyRound, Link2, RotateCw, ShieldCheck, Trash2, Webhook } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createApiKeyToken, displayApiKeyPrefix, normalizeApiKeyEnvironment } from '@/application/apiKeys'
import { StatusBadge, type StatusTone } from '@/presentation/shared/StatusBadge'
import { cn } from '@/lib/utils'

type ApiKeyScope = 'sending' | 'full'
type ApiKeyStatus = 'active' | 'revoked' | 'rotating'
type WebhookTopic = 'delivered' | 'bounced' | 'complained' | 'opened' | 'clicked'

interface ApiKeyRecord {
  id: string
  name: string
  prefix: string
  scope: ApiKeyScope
  status: ApiKeyStatus
  createdAt: string
  lastUsedAt: string
  expiresAt?: string
}

interface WebhookEndpoint {
  id: string
  name: string
  url: string
  topics: WebhookTopic[]
  status: 'healthy' | 'paused'
  lastDispatch: string
}

interface ApiKeysPageProps {
  /** Named on generated mock keys. The shell owns the header. */
  environment: string
}

const topicOptions: WebhookTopic[] = ['delivered', 'bounced', 'complained', 'opened', 'clicked']

const initialKeys: ApiKeyRecord[] = [
  {
    id: 'key_welcome_local',
    name: 'Welcome emails sandbox',
    prefix: 'st_local_K8m4q9d2…',
    scope: 'sending',
    status: 'active',
    createdAt: 'Sep 9, 2026',
    lastUsedAt: 'Dry-run only',
  },
  {
    id: 'key_internal_tools',
    name: 'Internal tools prototype',
    prefix: 'st_local_Q1r7p0x4…',
    scope: 'full',
    status: 'rotating',
    createdAt: 'Sep 8, 2026',
    lastUsedAt: 'Never',
    expiresAt: 'Expires in 24 h',
  },
]

const initialWebhooks: WebhookEndpoint[] = [
  {
    id: 'wh_delivery_audit',
    name: 'Delivery audit trail',
    url: 'https://ops.example.test/email-events',
    topics: ['delivered', 'bounced', 'complained'],
    status: 'healthy',
    lastDispatch: 'Test event queued',
  },
]

const snippetByLanguage = {
  'Node.js': `const response = await fetch('https://studio.example.com/api/v1/emails', {\n  method: 'POST',\n  headers: {\n    authorization: 'Bearer st_local_REPLACE_ME',\n    'content-type': 'application/json',\n    'idempotency-key': crypto.randomUUID(),\n  },\n  body: JSON.stringify({\n    template: 'welcome-verification',\n    to: 'ada@example.com',\n    props: { recipientName: 'Ada' },\n  }),\n})`,
  Python: `import os, requests, uuid\n\nrequests.post(\n    'https://studio.example.com/api/v1/emails',\n    headers={\n        'authorization': f"Bearer {os.environ['STUDIO_API_KEY']}",\n        'content-type': 'application/json',\n        'idempotency-key': str(uuid.uuid4()),\n    },\n    json={'template': 'welcome-verification', 'to': 'ada@example.com'},\n    timeout=10,\n)`,
  Go: `req, _ := http.NewRequest("POST", "https://studio.example.com/api/v1/emails", body)\nreq.Header.Set("Authorization", "Bearer "+os.Getenv("STUDIO_API_KEY"))\nreq.Header.Set("Content-Type", "application/json")\nreq.Header.Set("Idempotency-Key", uuid.NewString())`,
  cURL: `curl https://studio.example.com/api/v1/emails \\\n  -H "authorization: Bearer $STUDIO_API_KEY" \\\n  -H "content-type: application/json" \\\n  -H "idempotency-key: $(uuidgen)" \\\n  -d '{"template":"welcome-verification","to":"ada@example.com"}'`,
  Ruby: `request = Net::HTTP::Post.new('/api/v1/emails')\nrequest['authorization'] = "Bearer #{ENV.fetch('STUDIO_API_KEY')}"\nrequest['content-type'] = 'application/json'\nrequest['idempotency-key'] = SecureRandom.uuid\nrequest.body = JSON.dump(template: 'welcome-verification', to: 'ada@example.com')`,
} as const

type SnippetLanguage = keyof typeof snippetByLanguage

/**
 * Only the `<select>` below still uses this: shadcn has no select-styled native
 * element, and this file is mock UI that docs/PRIORITIES.md says not to refactor
 * further. The text fields are `<Input>`.
 */
const inputClass =
  'border-border bg-background focus-visible:ring-ring/50 h-8 w-full rounded-md border px-2 text-sm outline-none focus-visible:ring-3'

const scopeLabel: Record<ApiKeyScope, string> = { sending: 'Sending only', full: 'Full access' }
const scopeTone: Record<ApiKeyScope, StatusTone> = { sending: 'info', full: 'warning' }
const keyStatusTone: Record<ApiKeyStatus, StatusTone> = {
  active: 'success',
  revoked: 'neutral',
  rotating: 'warning',
}

export function ApiKeysPage({ environment }: ApiKeysPageProps) {
  const [keys, setKeys] = useState<ApiKeyRecord[]>(initialKeys)
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>(initialWebhooks)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [webhookOpen, setWebhookOpen] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRecord | null>(null)
  const activeKeys = keys.filter((key) => key.status !== 'revoked').length

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">API Keys &amp; Integration</h1>
            <StatusBadge tone="info">Seeded UI</StatusBadge>
          </div>
          <p className="text-muted-foreground max-w-2xl text-sm">
            Create browser-only mock keys, review webhook endpoints and copy starter snippets. Real
            authorization arrives when the Worker API keys table is wired to D1.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="bg-card text-muted-foreground flex h-7 items-center gap-2 rounded-md border px-2 font-mono text-xs">
            {activeKeys} active keys
            <span className="text-border" aria-hidden="true">
              |
            </span>
            <span className="text-foreground">{webhooks.length} webhook</span>
          </span>
          <Button variant="outline" size="sm" onClick={() => setWebhookOpen(true)}>
            <Webhook aria-hidden="true" />
            Add webhook
          </Button>
          <Button size="sm" onClick={() => setGenerateOpen(true)}>
            <KeyRound aria-hidden="true" />
            Generate key
          </Button>
        </div>
      </div>

      {/* `grid-cols-1` alone is not enough: a `1fr` track still refuses to be
          narrower than its content, and the key table below is 720px wide on
          purpose (it scrolls inside its own box). `minmax(0,1fr)` lets the
          track shrink to the screen so only the table scrolls, not the page. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <CredentialsManagerCard keys={keys} onRotate={setKeys} onRevoke={setRevokeTarget} />
        <IntegrationQuickstartCard onCopy={copyText} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <WebhookDispatchCard webhooks={webhooks} />
        <SecurityNotesCard />
      </div>

      <GenerateKeyDialog
        open={generateOpen}
        environment={environment}
        onOpenChange={setGenerateOpen}
        onCreate={(key) => setKeys((current) => [key, ...current])}
      />
      <CreateWebhookDialog
        open={webhookOpen}
        onOpenChange={setWebhookOpen}
        onCreate={(webhook) => setWebhooks((current) => [webhook, ...current])}
      />
      <RevokeKeyDialog
        keyRecord={revokeTarget}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null)
        }}
        onConfirm={(id) => {
          setKeys((current) =>
            current.map((key) =>
              key.id === id ? { ...key, status: 'revoked', lastUsedAt: 'Revoked just now' } : key,
            ),
          )
          setRevokeTarget(null)
          toast.info('API key revoked. Existing calls with that token will fail once the backend exists.')
        }}
      />
    </div>
  )
}

function CredentialsManagerCard({
  keys,
  onRotate,
  onRevoke,
}: {
  keys: ApiKeyRecord[]
  onRotate: Dispatch<SetStateAction<ApiKeyRecord[]>>
  onRevoke: (key: ApiKeyRecord) => void
}) {
  return (
    <section aria-labelledby="credentials-title" className="bg-card rounded-lg border">
      <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="credentials-title" className="text-sm font-medium">
            Credentials manager
          </h2>
          <p className="text-muted-foreground text-sm">
            Keys are shown as seeded UI only. The browser never stores real provider credentials.
          </p>
        </div>
        <StatusBadge tone="planned">Worker auth planned</StatusBadge>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-muted-foreground border-b text-xs">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Prefix</th>
              <th className="px-4 py-2 font-medium">Scope</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Last used</th>
              <th className="px-4 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {keys.map((key) => (
              <tr key={key.id} className={key.status === 'revoked' ? 'text-muted-foreground' : undefined}>
                <td className="px-4 py-3">
                  <div className="font-medium">{key.name}</div>
                  <div className="text-muted-foreground text-xs">Created {key.createdAt}</div>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{key.prefix}</td>
                <td className="px-4 py-3">
                  <StatusBadge tone={scopeTone[key.scope]}>{scopeLabel[key.scope]}</StatusBadge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1">
                    <StatusBadge tone={keyStatusTone[key.status]}>{key.status}</StatusBadge>
                    {key.expiresAt ? (
                      <span className="text-muted-foreground text-xs">{key.expiresAt}</span>
                    ) : null}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs">{key.lastUsedAt}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Rotate ${key.name}`}
                      disabled={key.status === 'revoked'}
                      onClick={() => {
                        onRotate((current) =>
                          current.map((item) =>
                            item.id === key.id
                              ? { ...item, status: 'rotating', expiresAt: 'Expires in 24 h' }
                              : item,
                          ),
                        )
                        toast.success('Rotation window started. Create the replacement key before expiry.')
                      }}
                    >
                      <RotateCw aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Revoke ${key.name}`}
                      disabled={key.status === 'revoked'}
                      onClick={() => onRevoke(key)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function IntegrationQuickstartCard({ onCopy }: { onCopy: (text: string, label: string) => void }) {
  const [language, setLanguage] = useState<SnippetLanguage>('Node.js')

  return (
    <section aria-labelledby="quickstart-title" className="bg-card rounded-lg border">
      <div className="border-b p-4">
        <h2 id="quickstart-title" className="text-sm font-medium">
          SDK quickstart
        </h2>
        <p className="text-muted-foreground text-sm">
          Start with plain HTTP. SDK packages can wait until the API contract stops moving.
        </p>
      </div>
      <div className="p-4">
        <Tabs value={language} onValueChange={(value) => setLanguage(value as SnippetLanguage)}>
          <TabsList variant="line" aria-label="Snippet language">
            {Object.keys(snippetByLanguage).map((item) => (
              <TabsTrigger key={item} value={item}>
                {item}
              </TabsTrigger>
            ))}
          </TabsList>
          {(Object.keys(snippetByLanguage) as SnippetLanguage[]).map((item) => (
            <TabsContent key={item} value={item} className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <StatusBadge tone="planned">Placeholder endpoint</StatusBadge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onCopy(snippetByLanguage[item], `${item} snippet`)}
                >
                  <Copy aria-hidden="true" />
                  Copy snippet
                </Button>
              </div>
              <pre className="bg-editor text-editor-foreground max-h-[360px] overflow-auto rounded-lg p-4 font-mono text-xs whitespace-pre-wrap">
                {snippetByLanguage[item]}
              </pre>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </section>
  )
}

function WebhookDispatchCard({ webhooks }: { webhooks: WebhookEndpoint[] }) {
  return (
    <section aria-labelledby="webhooks-title" className="bg-card rounded-lg border">
      <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="webhooks-title" className="text-sm font-medium">
            Webhook endpoints
          </h2>
          <p className="text-muted-foreground text-sm">
            Outbound event delivery is mocked until Queues and signed dispatches are added.
          </p>
        </div>
        <StatusBadge tone="planned">Dispatch log planned</StatusBadge>
      </div>
      <div className="divide-y">
        {webhooks.map((webhook) => (
          <article key={webhook.id} className="space-y-3 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="font-medium">{webhook.name}</h3>
                <p className="text-muted-foreground font-mono text-xs break-all">{webhook.url}</p>
              </div>
              <StatusBadge tone={webhook.status === 'healthy' ? 'success' : 'warning'}>
                {webhook.status}
              </StatusBadge>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {webhook.topics.map((topic) => (
                <StatusBadge key={topic} tone="neutral">
                  {topic}
                </StatusBadge>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">Last dispatch: {webhook.lastDispatch}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

function SecurityNotesCard() {
  return (
    <section aria-labelledby="security-title" className="bg-card rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <span className="bg-success-muted text-success-foreground rounded-md p-2">
          <ShieldCheck className="size-4" aria-hidden="true" />
        </span>
        <div className="space-y-3">
          <div>
            <h2 id="security-title" className="text-sm font-medium">
              Security model
            </h2>
            <p className="text-muted-foreground text-sm">
              Real keys will be hashed in the Worker. Webhook events will be signed with HMAC and a five
              minute replay window.
            </p>
          </div>
          <dl className="grid gap-3 text-xs">
            <div>
              <dt className="meta-label">Show once</dt>
              <dd className="text-muted-foreground">The full key is visible only in the generate dialog.</dd>
            </div>
            <div>
              <dt className="meta-label">Provider secret boundary</dt>
              <dd className="text-muted-foreground">
                AWS or Cloudflare credentials stay in Worker secrets, never in React.
              </dd>
            </div>
            <div>
              <dt className="meta-label">Backend dependency</dt>
              <dd className="text-muted-foreground">
                This page does not authorize requests until D1 and `/api/v1/emails` exist.
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  )
}

function GenerateKeyDialog({
  open,
  environment,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  environment: string
  onOpenChange: (open: boolean) => void
  onCreate: (key: ApiKeyRecord) => void
}) {
  const [name, setName] = useState('Transactional send key')
  const [scope, setScope] = useState<ApiKeyScope>('sending')
  const [generatedToken, setGeneratedToken] = useState<string | null>(null)
  const [stored, setStored] = useState(false)
  const apiEnvironment = normalizeApiKeyEnvironment(environment)

  function reset() {
    setName('Transactional send key')
    setScope('sending')
    setGeneratedToken(null)
    setStored(false)
  }

  function createKey() {
    const token = createApiKeyToken(apiEnvironment)
    setGeneratedToken(token)
    onCreate({
      id: `key_${Date.now()}`,
      name,
      prefix: displayApiKeyPrefix(token),
      scope,
      status: 'active',
      createdAt: 'Just now',
      lastUsedAt: 'Never',
    })
    toast.success('API key generated. Copy it now; it will not be shown again.')
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen)
        if (!nextOpen) reset()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate API key</DialogTitle>
          <DialogDescription>
            This creates a mock key for the integration page. Backend key hashing arrives with the Worker API.
          </DialogDescription>
        </DialogHeader>

        {generatedToken ? (
          <div className="space-y-4">
            <div className="border-success/30 bg-success-muted rounded-lg border p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <CheckCircle2 className="size-4" aria-hidden="true" />
                Key generated
              </div>
              <code className="bg-card block overflow-x-auto rounded-md border p-2 font-mono text-xs">
                {generatedToken}
              </code>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={stored}
                onChange={(event) => setStored(event.target.checked)}
              />
              I copied this key into a secure password manager or environment variable.
            </label>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-1.5 text-sm">
              <Label htmlFor="generate-key-name" className="meta-label">
                Name
              </Label>
              <Input id="generate-key-name" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <label className="grid gap-1.5 text-sm">
              <span className="meta-label">Scope</span>
              <select
                className={cn(inputClass, 'appearance-auto')}
                value={scope}
                onChange={(event) => setScope(event.target.value as ApiKeyScope)}
              >
                <option value="sending">Sending only</option>
                <option value="full">Full access</option>
              </select>
            </label>
          </div>
        )}

        <DialogFooter>
          {generatedToken ? (
            <>
              <Button variant="outline" onClick={() => copyText(generatedToken, 'API key')}>
                <Copy aria-hidden="true" />
                Copy key
              </Button>
              <Button disabled={!stored} onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </>
          ) : (
            <Button disabled={!name.trim()} onClick={createKey}>
              <KeyRound aria-hidden="true" />
              Generate key
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CreateWebhookDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (webhook: WebhookEndpoint) => void
}) {
  const [name, setName] = useState('App delivery events')
  const [url, setUrl] = useState('https://example.test/webhooks/email')
  const [topics, setTopics] = useState<WebhookTopic[]>(['delivered', 'bounced'])
  const valid = url.startsWith('https://') && topics.length > 0 && name.trim().length > 0

  function toggleTopic(topic: WebhookTopic) {
    setTopics((current) =>
      current.includes(topic) ? current.filter((item) => item !== topic) : [...current, topic],
    )
  }

  function reset() {
    setName('App delivery events')
    setUrl('https://example.test/webhooks/email')
    setTopics(['delivered', 'bounced'])
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen)
        if (!nextOpen) reset()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add webhook endpoint</DialogTitle>
          <DialogDescription>
            HTTPS endpoints will receive signed events after the Worker queue dispatcher is built.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5 text-sm">
            <Label htmlFor="webhook-name" className="meta-label">
              Name
            </Label>
            <Input id="webhook-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="grid gap-1.5 text-sm">
            <Label htmlFor="webhook-url" className="meta-label">
              Endpoint URL
            </Label>
            <Input id="webhook-url" value={url} onChange={(event) => setUrl(event.target.value)} />
            {!url.startsWith('https://') ? (
              <span className="text-danger-foreground text-xs">Use HTTPS.</span>
            ) : null}
          </div>
          <fieldset className="space-y-2">
            <legend className="meta-label">Topics</legend>
            <div className="flex flex-wrap gap-2">
              {topicOptions.map((topic) => {
                const selected = topics.includes(topic)
                return (
                  <button
                    key={topic}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleTopic(topic)}
                    className={cn(
                      'rounded-md border px-2 py-1 text-xs transition-colors',
                      selected
                        ? 'border-info/30 bg-info-muted text-info-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {topic}
                  </button>
                )
              })}
            </div>
          </fieldset>
        </div>
        <DialogFooter>
          <Button
            disabled={!valid}
            onClick={() => {
              onCreate({
                id: `wh_${Date.now()}`,
                name,
                url,
                topics,
                status: 'healthy',
                lastDispatch: 'No dispatches yet',
              })
              toast.success('Webhook endpoint added to the mock integration list.')
              onOpenChange(false)
              reset()
            }}
          >
            <Link2 aria-hidden="true" />
            Add endpoint
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RevokeKeyDialog({
  keyRecord,
  onOpenChange,
  onConfirm,
}: {
  keyRecord: ApiKeyRecord | null
  onOpenChange: (open: boolean) => void
  onConfirm: (id: string) => void
}) {
  return (
    <AlertDialog open={keyRecord !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke API key?</AlertDialogTitle>
          <AlertDialogDescription>
            {keyRecord
              ? `Calls using ${keyRecord.name} would stop working once real API authentication exists.`
              : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => keyRecord && onConfirm(keyRecord.id)}>
            Revoke key
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${label} copied.`)
  } catch {
    toast.info(`${label} selected. Copy it manually if your browser blocks clipboard access.`)
  }
}
