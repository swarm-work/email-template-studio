-- Migration 0002: the three starter templates that ship with the studio.
--
-- GENERATED FILE - do not edit by hand. Regenerate with `npm run seed:generate`
-- after changing a *.email.tsx starter or starterCatalog.json; the drift test in
-- server/seedMigration.test.ts fails when this file and its sources disagree.
--
-- Starters are real, editable rows: origin 'starter', created_by 'seed', ids
-- tpl_<slug>, history starting at version 1.

-- Welcome & verification
INSERT INTO templates (id, slug, name, description, category, status, tags, origin,
  current_version, revision, created_by, created_at, updated_by, updated_at)
VALUES ('tpl_welcome-verification', 'welcome-verification', 'Welcome & verification',
  'Sent after sign-up. Asks the user to confirm their email address before the account is activated.', 'onboarding', 'ready',
  '["sign-up","verification"]', 'starter',
  1, 1, 'seed', '2026-08-21T09:30:00Z', 'seed', '2026-08-21T09:30:00Z');

INSERT INTO template_versions (id, template_id, version_number, kind, subject, preheader,
  reply_to, source, document, theme, html, plain_text, props_sample, props_schema, note,
  created_by, created_at)
VALUES ('tpl_welcome-verification_v1', 'tpl_welcome-verification', 1, 'code',
  'Verify your email address', '',
  '', 'import * as React from ''react''
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from ''@react-email/components''

/**
 * Welcome + account verification email.
 *
 * Studio rules for template files:
 * - Only import from ''react'' and ''@react-email/components''.
 * - `export default` exactly one component; its props come from the preview payload.
 * - Keep styles inline (email clients ignore most stylesheets).
 */
export interface WelcomeVerificationProps {
  recipientName: string
  verificationUrl: string
  expiresInHours: number
  productName: string
  supportEmail: string
}

export default function WelcomeVerificationEmail({
  recipientName,
  verificationUrl,
  expiresInHours,
  productName,
  supportEmail,
}: WelcomeVerificationProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>Verify your email to finish setting up {productName}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section>
            <Text style={styles.eyebrow}>{productName}</Text>
            <Heading as="h1" style={styles.heading}>
              Welcome, {recipientName}
            </Heading>
            <Text style={styles.paragraph}>
              Confirm your email address to activate your account. This link expires in {expiresInHours}{'' ''}
              hours.
            </Text>
            <Button href={verificationUrl} style={styles.button}>
              Verify email address
            </Button>
            <Text style={styles.muted}>If the button does not work, paste this link into your browser:</Text>
            <Link href={verificationUrl} style={styles.link}>
              {verificationUrl}
            </Link>
          </Section>
          <Hr style={styles.divider} />
          <Text style={styles.footer}>
            You received this email because an account was created with this address. If that was not you,
            contact{'' ''}
            <Link href={`mailto:${supportEmail}`} style={styles.link}>
              {supportEmail}
            </Link>
            .
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

// `satisfies` keeps autocomplete for each key while checking every value is valid CSS.
const styles = {
  body: {
    backgroundColor: ''#f4f4f5'',
    fontFamily: ''Helvetica, Arial, sans-serif'',
    margin: 0,
    padding: ''32px 0'',
  },
  container: {
    backgroundColor: ''#ffffff'',
    border: ''1px solid #e4e4e7'',
    borderRadius: 8,
    margin: ''0 auto'',
    maxWidth: 560,
    padding: ''32px 40px'',
  },
  eyebrow: {
    color: ''#71717a'',
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: ''0.08em'',
    margin: ''0 0 16px'',
    textTransform: ''uppercase'',
  },
  heading: { color: ''#18181b'', fontSize: 24, fontWeight: 600, lineHeight: ''32px'', margin: ''0 0 12px'' },
  paragraph: { color: ''#3f3f46'', fontSize: 15, lineHeight: ''24px'', margin: ''0 0 24px'' },
  button: {
    backgroundColor: ''#18181b'',
    borderRadius: 6,
    color: ''#ffffff'',
    display: ''inline-block'',
    fontSize: 14,
    fontWeight: 600,
    padding: ''12px 20px'',
    textDecoration: ''none'',
  },
  muted: { color: ''#71717a'', fontSize: 13, lineHeight: ''20px'', margin: ''24px 0 4px'' },
  link: { color: ''#2563eb'', fontSize: 13, textDecoration: ''underline'', wordBreak: ''break-all'' },
  divider: { borderColor: ''#e4e4e7'', margin: ''32px 0 16px'' },
  footer: { color: ''#a1a1aa'', fontSize: 12, lineHeight: ''18px'', margin: 0 },
} satisfies Record<string, React.CSSProperties>
', NULL,
  'studio-v1', '', '',
  '{
  "recipientName": "Ada",
  "verificationUrl": "https://app.meridian.example/verify?token=sample-token",
  "expiresInHours": 24,
  "productName": "Meridian",
  "supportEmail": "support@meridian.example"
}
', '{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "recipientName": {
      "type": "string",
      "minLength": 1
    },
    "verificationUrl": {
      "type": "string",
      "format": "uri"
    },
    "expiresInHours": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 9007199254740991
    },
    "productName": {
      "type": "string",
      "minLength": 1
    },
    "supportEmail": {
      "type": "string",
      "format": "email",
      "pattern": "^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_''+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$"
    }
  },
  "required": [
    "recipientName",
    "verificationUrl",
    "expiresInHours",
    "productName",
    "supportEmail"
  ],
  "additionalProperties": false
}
', 'Seeded starter template.',
  'seed', '2026-08-21T09:30:00Z');

-- Password reset
INSERT INTO templates (id, slug, name, description, category, status, tags, origin,
  current_version, revision, created_by, created_at, updated_by, updated_at)
VALUES ('tpl_password-reset', 'password-reset', 'Password reset',
  'Time-limited link to choose a new password, with optional request details for security context.', 'security', 'ready',
  '["security","account"]', 'starter',
  1, 1, 'seed', '2026-09-02T14:05:00Z', 'seed', '2026-09-02T14:05:00Z');

INSERT INTO template_versions (id, template_id, version_number, kind, subject, preheader,
  reply_to, source, document, theme, html, plain_text, props_sample, props_schema, note,
  created_by, created_at)
VALUES ('tpl_password-reset_v1', 'tpl_password-reset', 1, 'code',
  'Reset your password', '',
  '', 'import * as React from ''react''
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from ''@react-email/components''

/**
 * Password reset email. Optional props show how to model "may be missing"
 * fields: the request details section is only rendered when both are present.
 */
export interface PasswordResetProps {
  recipientName: string
  resetUrl: string
  expiresInMinutes: number
  productName: string
  requestIp?: string
  requestLocation?: string
}

export default function PasswordResetEmail({
  recipientName,
  resetUrl,
  expiresInMinutes,
  productName,
  requestIp,
  requestLocation,
}: PasswordResetProps) {
  const hasRequestDetails = Boolean(requestIp && requestLocation)

  return (
    <Html lang="en">
      <Head />
      <Preview>Reset your {productName} password</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section>
            <Text style={styles.eyebrow}>{productName} security</Text>
            <Heading as="h1" style={styles.heading}>
              Reset your password
            </Heading>
            <Text style={styles.paragraph}>
              Hi {recipientName}, we received a request to reset the password for your account. This link is
              valid for {expiresInMinutes} minutes.
            </Text>
            <Button href={resetUrl} style={styles.button}>
              Choose a new password
            </Button>
          </Section>
          {hasRequestDetails ? (
            <Section style={styles.detailBox}>
              <Text style={styles.detailLabel}>Request details</Text>
              <Text style={styles.detailValue}>IP address: {requestIp}</Text>
              <Text style={styles.detailValue}>Approximate location: {requestLocation}</Text>
            </Section>
          ) : null}
          <Hr style={styles.divider} />
          <Text style={styles.footer}>
            If you did not request a password reset, you can safely ignore this email. Your password will not
            change.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

const styles = {
  body: {
    backgroundColor: ''#f4f4f5'',
    fontFamily: ''Helvetica, Arial, sans-serif'',
    margin: 0,
    padding: ''32px 0'',
  },
  container: {
    backgroundColor: ''#ffffff'',
    border: ''1px solid #e4e4e7'',
    borderRadius: 8,
    margin: ''0 auto'',
    maxWidth: 560,
    padding: ''32px 40px'',
  },
  eyebrow: {
    color: ''#b45309'',
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: ''0.08em'',
    margin: ''0 0 16px'',
    textTransform: ''uppercase'',
  },
  heading: { color: ''#18181b'', fontSize: 24, fontWeight: 600, lineHeight: ''32px'', margin: ''0 0 12px'' },
  paragraph: { color: ''#3f3f46'', fontSize: 15, lineHeight: ''24px'', margin: ''0 0 24px'' },
  button: {
    backgroundColor: ''#18181b'',
    borderRadius: 6,
    color: ''#ffffff'',
    display: ''inline-block'',
    fontSize: 14,
    fontWeight: 600,
    padding: ''12px 20px'',
    textDecoration: ''none'',
  },
  detailBox: {
    backgroundColor: ''#fafafa'',
    border: ''1px solid #e4e4e7'',
    borderRadius: 6,
    marginTop: 24,
    padding: ''12px 16px'',
  },
  detailLabel: {
    color: ''#71717a'',
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: ''0.04em'',
    margin: ''0 0 6px'',
    textTransform: ''uppercase'',
  },
  detailValue: {
    color: ''#3f3f46'',
    fontFamily: ''Menlo, Consolas, monospace'',
    fontSize: 13,
    lineHeight: ''20px'',
    margin: 0,
  },
  divider: { borderColor: ''#e4e4e7'', margin: ''32px 0 16px'' },
  footer: { color: ''#a1a1aa'', fontSize: 12, lineHeight: ''18px'', margin: 0 },
} satisfies Record<string, React.CSSProperties>
', NULL,
  'studio-v1', '', '',
  '{
  "recipientName": "Grace",
  "resetUrl": "https://app.meridian.example/reset?token=sample-token",
  "expiresInMinutes": 30,
  "productName": "Meridian",
  "requestIp": "203.0.113.42",
  "requestLocation": "Manila, PH"
}
', '{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "recipientName": {
      "type": "string",
      "minLength": 1
    },
    "resetUrl": {
      "type": "string",
      "format": "uri"
    },
    "expiresInMinutes": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 9007199254740991
    },
    "productName": {
      "type": "string",
      "minLength": 1
    },
    "requestIp": {
      "type": "string"
    },
    "requestLocation": {
      "type": "string"
    }
  },
  "required": [
    "recipientName",
    "resetUrl",
    "expiresInMinutes",
    "productName"
  ],
  "additionalProperties": false
}
', 'Seeded starter template.',
  'seed', '2026-09-02T14:05:00Z');

-- Team invitation
INSERT INTO templates (id, slug, name, description, category, status, tags, origin,
  current_version, revision, created_by, created_at, updated_by, updated_at)
VALUES ('tpl_team-invitation', 'team-invitation', 'Team invitation',
  'Invites a person to join a team with a specific role. Uses Row/Column layout.', 'collaboration', 'draft',
  '["teams","invitation"]', 'starter',
  1, 1, 'seed', '2026-09-05T11:00:00Z', 'seed', '2026-09-05T11:00:00Z');

INSERT INTO template_versions (id, template_id, version_number, kind, subject, preheader,
  reply_to, source, document, theme, html, plain_text, props_sample, props_schema, note,
  created_by, created_at)
VALUES ('tpl_team-invitation_v1', 'tpl_team-invitation', 1, 'code',
  'You have been invited to join a team', '',
  '', 'import * as React from ''react''
import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Row,
  Section,
  Text,
} from ''@react-email/components''

/**
 * Team invitation email. Demonstrates a union-typed prop (`role`) and the
 * Row/Column layout primitives from React Email.
 */
export interface TeamInvitationProps {
  inviteeName: string
  inviterName: string
  teamName: string
  role: ''admin'' | ''member'' | ''viewer''
  acceptUrl: string
  expiresInDays: number
  productName: string
}

const ROLE_DESCRIPTIONS: Record<TeamInvitationProps[''role''], string> = {
  admin: ''Can manage members, billing and settings.'',
  member: ''Can create and edit projects.'',
  viewer: ''Can view projects but not change them.'',
}

export default function TeamInvitationEmail({
  inviteeName,
  inviterName,
  teamName,
  role,
  acceptUrl,
  expiresInDays,
  productName,
}: TeamInvitationProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>
        {inviterName} invited you to join {teamName} on {productName}
      </Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section>
            <Text style={styles.eyebrow}>{productName}</Text>
            <Heading as="h1" style={styles.heading}>
              Join {teamName}
            </Heading>
            <Text style={styles.paragraph}>
              Hi {inviteeName}, {inviterName} has invited you to collaborate with the {teamName} team.
            </Text>
          </Section>
          <Section style={styles.roleBox}>
            <Row>
              <Column style={styles.roleLabelColumn}>
                <Text style={styles.roleLabel}>Your role</Text>
              </Column>
              <Column>
                <Text style={styles.roleName}>{role}</Text>
                <Text style={styles.roleDescription}>{ROLE_DESCRIPTIONS[role]}</Text>
              </Column>
            </Row>
          </Section>
          <Section>
            <Button href={acceptUrl} style={styles.button}>
              Accept invitation
            </Button>
            <Text style={styles.muted}>This invitation expires in {expiresInDays} days.</Text>
          </Section>
          <Hr style={styles.divider} />
          <Text style={styles.footer}>
            If you were not expecting this invitation, you can ignore this email and no account will be
            created.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

const styles = {
  body: {
    backgroundColor: ''#f4f4f5'',
    fontFamily: ''Helvetica, Arial, sans-serif'',
    margin: 0,
    padding: ''32px 0'',
  },
  container: {
    backgroundColor: ''#ffffff'',
    border: ''1px solid #e4e4e7'',
    borderRadius: 8,
    margin: ''0 auto'',
    maxWidth: 560,
    padding: ''32px 40px'',
  },
  eyebrow: {
    color: ''#71717a'',
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: ''0.08em'',
    margin: ''0 0 16px'',
    textTransform: ''uppercase'',
  },
  heading: { color: ''#18181b'', fontSize: 24, fontWeight: 600, lineHeight: ''32px'', margin: ''0 0 12px'' },
  paragraph: { color: ''#3f3f46'', fontSize: 15, lineHeight: ''24px'', margin: ''0 0 24px'' },
  roleBox: {
    backgroundColor: ''#fafafa'',
    border: ''1px solid #e4e4e7'',
    borderRadius: 6,
    marginBottom: 24,
    padding: ''12px 16px'',
  },
  roleLabelColumn: { width: 96, verticalAlign: ''top'' },
  roleLabel: {
    color: ''#71717a'',
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: ''0.04em'',
    margin: 0,
    textTransform: ''uppercase'',
  },
  roleName: { color: ''#18181b'', fontSize: 14, fontWeight: 600, margin: 0, textTransform: ''capitalize'' },
  roleDescription: { color: ''#52525b'', fontSize: 13, lineHeight: ''20px'', margin: ''2px 0 0'' },
  button: {
    backgroundColor: ''#18181b'',
    borderRadius: 6,
    color: ''#ffffff'',
    display: ''inline-block'',
    fontSize: 14,
    fontWeight: 600,
    padding: ''12px 20px'',
    textDecoration: ''none'',
  },
  muted: { color: ''#71717a'', fontSize: 13, lineHeight: ''20px'', margin: ''16px 0 0'' },
  divider: { borderColor: ''#e4e4e7'', margin: ''32px 0 16px'' },
  footer: { color: ''#a1a1aa'', fontSize: 12, lineHeight: ''18px'', margin: 0 },
} satisfies Record<string, React.CSSProperties>
', NULL,
  'studio-v1', '', '',
  '{
  "inviteeName": "Linus",
  "inviterName": "Margaret Hamilton",
  "teamName": "Platform Core",
  "role": "member",
  "acceptUrl": "https://app.meridian.example/invitations/sample-token",
  "expiresInDays": 7,
  "productName": "Meridian"
}
', '{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "inviteeName": {
      "type": "string",
      "minLength": 1
    },
    "inviterName": {
      "type": "string",
      "minLength": 1
    },
    "teamName": {
      "type": "string",
      "minLength": 1
    },
    "role": {
      "type": "string",
      "enum": [
        "admin",
        "member",
        "viewer"
      ]
    },
    "acceptUrl": {
      "type": "string",
      "format": "uri"
    },
    "expiresInDays": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 9007199254740991
    },
    "productName": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "inviteeName",
    "inviterName",
    "teamName",
    "role",
    "acceptUrl",
    "expiresInDays",
    "productName"
  ],
  "additionalProperties": false
}
', 'Seeded starter template.',
  'seed', '2026-09-05T11:00:00Z');
