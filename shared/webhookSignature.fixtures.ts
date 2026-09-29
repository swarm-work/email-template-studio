/**
 * A published, independently-computed test vector for Standard
 * Webhooks-shaped signing (the same HMAC-SHA256-over-`id.timestamp.body`
 * scheme decision 38 adopts), vendored here instead of only testing the
 * signer against itself.
 *
 * Source: the Svix docs' manual-verification walkthrough,
 * https://docs.svix.com/receiving/verifying-payloads/how-manual
 * (fetched 2026-09-29). Re-derived independently with `node:crypto` in this
 * session and confirmed to match before being trusted as a test oracle:
 * HMAC-SHA256 with key = base64-decode("plJ3nmyCDGBKInavdOK15jsl"), over
 * "msg_loFOjxBNrRLzqYUf.1731705121.{"event_type":"ping","data":{"success":true}}"
 * produces exactly the `expectedSignature` below.
 *
 * The timestamp (a real Unix second value from 2024) is old, so any test that
 * calls `verifyWebhook` with it must pass an explicit `nowSeconds` near that
 * timestamp rather than the real current time.
 */
export const svixVector = {
  secret: 'whsec_plJ3nmyCDGBKInavdOK15jsl',
  id: 'msg_loFOjxBNrRLzqYUf',
  timestampSeconds: 1731705121,
  body: '{"event_type":"ping","data":{"success":true}}',
  expectedSignature: 'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=',
}
