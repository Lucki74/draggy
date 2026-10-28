import React, { useEffect, useRef, useState } from "react";
import { Icon, IconButton } from "../ui";
import type { QueuedMessage } from "../types";

export interface QueueCardProps {
    queue: QueuedMessage[];
    editing: { id: string; text: string } | null;
    setEditing: (editing: { id: string; text: string } | null) => void;
    saveEdit: () => void;
    onMove: (id: string, offset: number) => void;
    onSendNow: (id: string) => void;
    onRemove: (id: string) => void;
    onClear: () => void;
    t: (key: string) => string;
}

/** Messages waiting for their turn, docked above the composer like a tray the user can reorder. */
export function QueueCard({ queue, editing, setEditing, saveEdit, onMove, onSendNow, onRemove, onClear, t }: QueueCardProps) {
    const [dragId, setDragId] = useState<string | null>(null);
    const [announce, setAnnounce] = useState("");
    const previous = useRef(queue.length);

    useEffect(() => {
        if (queue.length > previous.current) {
            setAnnounce(t("queueAnnounce").replace("{count}", String(queue.length)));
        }
        previous.current = queue.length;
    }, [queue.length, t]);

    const drop = (targetId: string) => {
        const from = queue.findIndex((item) => item.id === dragId);
        const to = queue.findIndex((item) => item.id === targetId);
        setDragId(null);
        if (from === -1 || to === -1 || from === to) return;
        onMove(queue[from].id, to - from);
    };

    return (
        <section
            aria-label={t("queuedMessages")}
            className="mb-2 overflow-hidden rounded-lg border border-rule bg-surface-base"
        >
            <header className="flex items-center gap-2 ps-3 pe-1 py-1 text-[12px] text-text-secondary">
                <Icon name="clock" size={14} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{t("queuedMessages")} · {queue.length}</span>
                <button
                    type="button"
                    onClick={onClear}
                    className="rounded-pill px-2 py-0.5 text-[12px] text-text-secondary transition-colors duration-120 hover:bg-surface-raised hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
                >
                    {t("queueClear")}
                </button>
            </header>
            {/* A burst of queued messages scrolls here instead of pushing the transcript away. */}
            <ul className="flex max-h-[min(30vh,14rem)] flex-col overflow-y-auto border-t border-rule">
                {queue.map((item, index) => (
                    <li
                        key={item.id}
                        draggable={editing?.id !== item.id}
                        onDragStart={() => setDragId(item.id)}
                        onDragOver={(e) => {
                            if (dragId) e.preventDefault();
                        }}
                        onDrop={(e) => {
                            e.preventDefault();
                            drop(item.id);
                        }}
                        onDragEnd={() => setDragId(null)}
                        tabIndex={0}
                        aria-label={`${index + 1}. ${item.content}`}
                        onKeyDown={(e) => {
                            if (e.target !== e.currentTarget || !e.altKey) return;
                            const offset = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
                            if (!offset) return;
                            e.preventDefault();
                            onMove(item.id, offset);
                        }}
                        className={`group flex shrink-0 items-center gap-2 ps-3 pe-1 text-[13px] text-text-primary transition-colors duration-120 hover:bg-surface-tint focus-visible:bg-surface-tint focus-visible:outline-none ${
                            dragId === item.id ? "opacity-50" : ""
                        } ${index > 0 ? "border-t border-rule" : ""}`}
                    >
                        <span className="w-4 shrink-0 text-end text-[11px] text-text-tertiary">{index + 1}</span>
                        {editing?.id === item.id ? (
                            <textarea
                                autoFocus
                                aria-label={t("edit")}
                                value={editing.text}
                                rows={1}
                                onChange={(e) => setEditing({ id: item.id, text: e.target.value })}
                                onKeyDown={(e) => {
                                    if (e.key === "Escape") {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setEditing(null);
                                    } else if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        saveEdit();
                                    }
                                }}
                                className="min-w-0 flex-1 resize-none bg-transparent py-1.5 focus:outline-none"
                            />
                        ) : (
                            <span className="min-w-0 flex-1 truncate py-1.5">{item.content}</span>
                        )}
                        {editing?.id !== item.id && (
                            <span className="flex shrink-0 items-center opacity-0 transition-opacity duration-120 group-hover:opacity-100 group-focus-within:opacity-100">
                                <IconButton
                                    name="skip-forward"
                                    label={t("queueSendNow")}
                                    size="dense"
                                    onClick={() => onSendNow(item.id)}
                                />
                                <IconButton
                                    name="pencil-simple"
                                    label={t("edit")}
                                    size="dense"
                                    onClick={() => setEditing({ id: item.id, text: item.content })}
                                />
                                <IconButton
                                    name="trash"
                                    label={t("queueRemove")}
                                    size="dense"
                                    onClick={() => onRemove(item.id)}
                                />
                            </span>
                        )}
                    </li>
                ))}
            </ul>
            <p role="status" className="sr-only">{announce}</p>
        </section>
    );
}
