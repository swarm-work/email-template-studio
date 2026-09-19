import * as React from 'react'
import { Body, Container, Head, Html, Link, Preview, Text } from '@react-email/components'

/**
 * MarksEmail: converted from a visual template.
 *
 * Subject: The marks fixture
 *
 * This file is the template now. The visual document it came from was
 * discarded, and hand-written TSX cannot be converted back to a canvas.
 * Every {{key}} merge field became a prop, so the same preview payload
 * keeps working.
 */

export default function MarksEmail() {
  return (
    <Html lang="en">
      <Head />
      <Preview>{'A preheader for marks'}</Preview>
      <Body>
        <Container style={styles.container}>
          <Text style={styles.text}>
            {'Plain, '}
            <strong>{'bold'}</strong>
            {', '}
            <em>{'italic'}</em>
            {', '}
            <u>{'underline'}</u>
            {', '}
            <s>{'struck'}</s>
            {', '}
            <code>{'code'}</code>
            {', x'}
            <sup>{'2'}</sup>
            {', '}
            <span style={styles.uppercase}>{'shouty'}</span>
            {', '}
            <span style={styles.preservedStyle}>{'kept'}</span>
            {' and '}
            <Link href="https://example.com/docs" target="_blank" rel="noopener noreferrer nofollow">
              {'a link'}
            </Link>
            {'.'}
            <strong>
              <em>{' Both at once.'}</em>
            </strong>
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

const styles = {
  container: { maxWidth: '600px' },
  text: { fontSize: '15px', lineHeight: '24px' },
  uppercase: { textTransform: 'uppercase' },
  preservedStyle: { color: '#2563eb' },
} satisfies Record<string, React.CSSProperties>
