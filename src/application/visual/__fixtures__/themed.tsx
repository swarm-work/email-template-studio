import * as React from 'react'
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
} from '@react-email/components'

/**
 * ThemedEmail: converted from a visual template.
 *
 * Subject: The themed fixture
 *
 * This file is the template now. The visual document it came from was
 * discarded, and hand-written TSX cannot be converted back to a canvas.
 * Every {{key}} merge field became a prop, so the same preview payload
 * keeps working.
 */

export default function ThemedEmail() {
  return (
    <Html lang="en">
      <Head />
      <Preview>{'A preheader for themed'}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading as="h2" style={styles.heading2}>
            {"Here's what's new"}
          </Heading>
          <Text style={styles.text}>{'She said "hello" to the whole team.'}</Text>
          <Text style={styles.text2}>
            {'Read '}
            <Link href="https://example.com/r?a=1&amp;amp;b=2" style={styles.link}>
              {'the report'}
            </Link>
            {' before Friday.'}
          </Text>
          <Text style={styles.text2}>{'Justified on the canvas is not justified here.'}</Text>
          <Hr style={styles.hr} />
          <Section style={styles.buttonRow}>
            <Button href="https://example.com/start" style={styles.button}>
              {'Open the studio'}
            </Button>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

const styles = {
  container: { maxWidth: '600px', padding: '24px' },
  heading2: { fontSize: '28px', fontWeight: '600' },
  text: { fontSize: '14px', lineHeight: '155%', textAlign: 'center', color: '#334155' },
  text2: { fontSize: '14px', lineHeight: '155%', textAlign: 'left' },
  link: { color: '#2563eb', textDecoration: 'underline' },
  hr: { borderColor: '#e2e8f0' },
  buttonRow: { textAlign: 'center' },
  button: { backgroundColor: '#111827', color: '#ffffff', borderRadius: '6px' },
  body: { backgroundColor: '#ffffff', lineHeight: '155%', fontFamily: 'Inter, Helvetica, sans-serif' },
} satisfies Record<string, React.CSSProperties>
