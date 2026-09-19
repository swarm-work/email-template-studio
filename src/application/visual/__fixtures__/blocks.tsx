import * as React from 'react'
import { Body, Button, Container, Head, Hr, Html, Preview, Section, Text } from '@react-email/components'

/**
 * BlocksEmail: converted from a visual template.
 *
 * Subject: The blocks fixture
 *
 * This file is the template now. The visual document it came from was
 * discarded, and hand-written TSX cannot be converted back to a canvas.
 * Every {{key}} merge field became a prop, so the same preview payload
 * keeps working.
 */

export default function BlocksEmail() {
  return (
    <Html lang="en">
      <Head />
      <Preview>{'A preheader for blocks'}</Preview>
      <Body>
        <Container>
          <Section style={styles.section}>
            <Section style={styles.section2}>
              <Text>
                {'First line'}
                <br />
                {'second line after a hard break'}
              </Text>
            </Section>
          </Section>
          <Section style={styles.buttonRow}>
            <Button href="https://example.com/start" style={styles.button}>
              {'Get started'}
            </Button>
          </Section>
          <Hr style={styles.hr} />
          <Text>
            {
              'A closing paragraph long enough that the printer has to break the element across several lines instead of keeping it on one.'
            }
          </Text>
          <Text>
            <br />
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

const styles = {
  section: { backgroundColor: '#f4f4f5', padding: '16px' },
  section2: { borderLeft: '3px solid #18181b' },
  buttonRow: { textAlign: 'center' },
  button: { backgroundColor: '#18181b', borderRadius: '6px', color: '#ffffff', padding: '12px 20px' },
  hr: { borderColor: '#e4e4e7' },
} satisfies Record<string, React.CSSProperties>
