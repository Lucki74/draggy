/** Whether a text step already holds the whole body and carries on from it, as a continued reply
 * does while it streams. The body is then left out, or its words would show twice. */
export function continuesBody(body: string, step: string): boolean {
  const head = body.trimStart().slice(0, 60);
  return head.length > 0 && step.trimStart().startsWith(head);
}
