import * as React from 'react'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'

/**
 * MergeFieldsEmail: converted from a visual template.
 *
 * Subject: The merge-fields fixture
 *
 * This file is the template now. The visual document it came from was
 * discarded, and hand-written TSX cannot be converted back to a canvas.
 * Every {{key}} merge field became a prop, so the same preview payload
 * keeps working.
 */

export interface MergeFieldsProps {
  userFirstName: string
  recipientName: string
  invoiceTotal: string
  invoiceId: string
  portalUrl: string
}

export default function MergeFieldsEmail({
  userFirstName,
  recipientName,
  invoiceTotal,
  invoiceId,
  portalUrl,
}: MergeFieldsProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{'A preheader for merge-fields'}</Preview>
      <Body>
        <Container>
          <Heading as="h1">{userFirstName}</Heading>
          <Text>
            {'Hi '}
            {recipientName}
            {', your invoice for '}
            {invoiceTotal}
            {' is ready.'}
          </Text>
          <Text>
            <Link href={`https://example.com/i/${invoiceId}`}>{`View invoice ${invoiceId}`}</Link>
          </Text>
          <Section style={styles.buttonRow}>
            <Button href={portalUrl}>{'Open the billing portal'}</Button>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

const styles = {
  buttonRow: { textAlign: 'left' },
} satisfies Record<string, React.CSSProperties>
