import * as React from 'react'
import { Body, Container, Head, Html, Img, Link, Preview } from '@react-email/components'

/**
 * ImagesEmail: converted from a visual template.
 *
 * Subject: The images fixture
 *
 * This file is the template now. The visual document it came from was
 * discarded, and hand-written TSX cannot be converted back to a canvas.
 * Every {{key}} merge field became a prop, so the same preview payload
 * keeps working.
 */

export default function ImagesEmail() {
  return (
    <Html lang="en">
      <Head />
      <Preview>{'A preheader for images'}</Preview>
      <Body>
        <Container>
          <Link href="https://example.com/whats-new">
            <Img
              src="https://studio.example/media/img_hero.png"
              alt="The new dashboard"
              width="600"
              height="280"
              style={styles.image}
            />
          </Link>
          <Img src="https://studio.example/media/img_logo.png" alt="Meridian" width={120} />
          <Img
            src="https://studio.example/media/img_inline.png?size=large&amp;amp;dpr=2"
            alt="A screenshot"
          />
        </Container>
      </Body>
    </Html>
  )
}

const styles = {
  image: { borderRadius: '8px' },
} satisfies Record<string, React.CSSProperties>
