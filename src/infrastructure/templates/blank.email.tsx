/**
 * What a brand-new CODE template starts as.
 *
 * Infrastructure layer: a real `.tsx` file (so the compiler checks it) that the
 * create dialog also reads as TEXT through Vite's `?raw`, exactly like the
 * three starters next to it. Keep it short — it is the first thing somebody
 * sees in the editor — and keep it renderable.
 */
import { Body, Container, Head, Heading, Html, Preview, Section, Text } from '@react-email/components'

export interface BlankEmailProps {
  /** Shown in the preview line and in the sign-off. */
  productName: string
}

export default function BlankEmail({ productName }: BlankEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>A new email from {productName}</Preview>
      <Body style={body}>
        <Container style={container}>
          {/* {'{{firstName}}'} is a MERGE FIELD, not JSX: the braces are inside a
              string, so they survive the render and the studio fills them in
              from the preview payload. Writing {firstName} bare would be a
              JavaScript expression and this template has no such variable. */}
          <Heading as="h1" style={heading}>
            Hi {'{{firstName}}'},
          </Heading>
          <Section>
            <Text style={text}>
              This is your new {productName} template. Replace this text, add sections, and press ⌘S to save a
              version.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

const body = { backgroundColor: '#f6f7f9', fontFamily: 'Helvetica, Arial, sans-serif' }

const container = {
  backgroundColor: '#ffffff',
  border: '1px solid #e6e8eb',
  borderRadius: '12px',
  margin: '32px auto',
  maxWidth: '600px',
  padding: '32px',
}

const heading = { color: '#101317', fontSize: '22px', margin: '0 0 12px' }

const text = { color: '#3c4149', fontSize: '15px', lineHeight: '24px', margin: '0' }
