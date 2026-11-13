// Hosts whose icon already 404'd or failed this session, so rows stop requesting them.
const missingIcons = new Set<string>();

export function iconMissing(hostname: string): boolean {
  return missingIcons.has(hostname);
}

export function markIconMissing(hostname: string): void {
  missingIcons.add(hostname);
}
