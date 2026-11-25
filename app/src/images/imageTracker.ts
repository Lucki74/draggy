import type { Attachment, ImageRequest, Message } from "../types";

/** Every picture in a chat gets a short stable ID, so the model can say which one to start from. The IDs are
 * read off the saved messages in order, so they survive a restart and need no storage of their own. */

export const DEFAULT_REFERENCE_STRENGTH = 0.35;

/** How far a reference may move: what was asked for, else the low default when a reference is in use. */
export function referenceStrength(hasReference: boolean, explicit?: number): number | undefined {
  return explicit ?? (hasReference ? DEFAULT_REFERENCE_STRENGTH : undefined);
}

export interface TrackedImage {
  id: string;
  origin: "generated" | "attached";
  messageId: string;
  /** What the picture was asked for, or the attachment's file name. */
  label: string;
  width?: number;
  height?: number;
  seed?: number;
  /** Generated pictures: where the file is. */
  path?: string;
  location?: "created" | "project";
  workspaceId?: string;
  /** Attached pictures: the data URL, held in the chat already. */
  dataUrl?: string;
}

function dataUrlOf(file: Attachment): string | null {
  if (!file.type.startsWith("image/") || !file.content) return null;
  return file.content.startsWith("data:") ? file.content : `data:${file.type};base64,${file.content}`;
}

/** The pictures in these messages, numbered from img_1 in the order they appear. */
export function trackImages(messages: Message[]): TrackedImage[] {
  const tracked: TrackedImage[] = [];
  const next = () => `img_${tracked.length + 1}`;
  for (const message of messages) {
    for (const file of message.attachments ?? []) {
      const dataUrl = dataUrlOf(file);
      if (dataUrl) tracked.push({ id: next(), origin: "attached", messageId: message.id, label: file.name, dataUrl });
    }
    for (const step of message.steps ?? []) {
      const info = step.image;
      if (step.type !== "image" || !info || info.status !== "done" || !info.path) continue;
      tracked.push({
        id: next(),
        origin: "generated",
        messageId: message.id,
        label: info.prompt,
        width: info.width,
        height: info.height,
        seed: info.seed,
        path: info.path,
        location: info.location,
        workspaceId: info.workspaceId,
      });
    }
  }
  return tracked;
}

/** The model's text index: one line per picture, never its bytes. */
export function imageIndex(images: TrackedImage[]): string {
  if (images.length === 0) return "";
  const lines = images.map((image) => {
    const size = image.width && image.height ? `, ${image.width}x${image.height}` : "";
    const origin = image.origin === "attached" ? `attached by the user (${image.label})` : `generated: "${image.label.slice(0, 120)}"${size}`;
    return `- ${image.id}: ${origin}`;
  });
  return `Pictures in this chat (pass an ID as reference_image to generate_image to change a detail of one and keep the rest):\n${lines.join("\n")}`;
}

/** The starting picture for a tracked ID, or null when the chat has no such picture. */
export function referenceFor(images: TrackedImage[], id: unknown): { image: TrackedImage; init: NonNullable<ImageRequest["init"]> } | null {
  const wanted = String(id ?? "").trim().toLowerCase();
  const image = images.find((item) => item.id === wanted);
  if (!image) return null;
  if (image.origin === "attached" && image.dataUrl) return { image, init: { kind: "attachment", dataUrl: image.dataUrl } };
  if (image.location === "project" && image.path) {
    return { image, init: { kind: "project", workspaceId: image.workspaceId || "default", path: image.path, optional: true } };
  }
  if (image.path) return { image, init: { kind: "created", path: image.path } };
  return null;
}
