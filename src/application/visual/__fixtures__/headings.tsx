import * as React from 'react'
import { Body, Container, Head, Heading, Html } from '@react-email/components'

/**
 * HeadingsEmail: converted from a visual template.
 *
 * Subject: The headings fixture
 *
 * This file is the template now. The visual document it came from was
 * discarded, and hand-written TSX cannot be converted back to a canvas.
 * Every {{key}} merge field became a prop, so the same preview payload
 * keeps working.
 */

export default function HeadingsEmail() {
  return (
    <Html lang="en">
      <Head />
      <Body>
        <Container>
          <Heading as="h1">{'Level one'}</Heading>
          <Heading as="h2">{'Level two'}</Heading>
          <Heading as="h3" style={styles.heading3}>
            {'Level three, centred'}
          </Heading>
          <Heading as="h4">{'Level four'}</Heading>
          <Heading as="h5">{'Level five'}</Heading>
          <Heading as="h6">{'Level six'}</Heading>
        </Container>
      </Body>
    </Html>
  )
}

const styles = {
  heading3: { textAlign: 'center' },
} satisfies Record<string, React.CSSProperties>
