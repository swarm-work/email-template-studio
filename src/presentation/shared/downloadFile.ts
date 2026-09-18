/**
 * Hands the browser a string to save as a file.
 *
 * Presentation layer: one browser API call, no rules. Nothing is uploaded and
 * no server is involved — the text is wrapped in a Blob, given a temporary
 * object URL, and a hidden `<a download>` is clicked on the reader's behalf.
 * Must not import React or anything from the domain.
 */

/**
 * Saves `content` as `fileName`. `mediaType` is the MIME type the blob claims,
 * which is what decides the default application the file opens in.
 */
export function downloadTextFile(fileName: string, content: string, mediaType: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: `${mediaType};charset=utf-8` }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  // The anchor never reaches the page visually; it is created, clicked and
  // removed inside one task, and Firefox needs it in the document to fire.
  document.body.append(link)
  link.click()
  link.remove()
  // An object URL pins its blob in memory until it is revoked, but revoking it
  // in the same task as the click has historically cancelled the download in
  // Firefox and older WebKit. One turn of the event loop later is late enough
  // for every browser to have taken the blob, and early enough to free it.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
