// Types for metrics.mjs.
import type { Corpus } from "./replay.mjs";

export type Citation = { n: number; url: string; quote: string };
export function normalise(s: string): string;
export function parseAnswer(text: string): { body: string; citations: Citation[] };
export function citationPrecision(citations: Citation[], corpus: Corpus): { supported: number; total: number };
export function citationRecall(body: string): { cited: number; total: number };
export function fillTemplate(template: string, values: Record<string, unknown>): string;
export function parseVerdict(text: string): "correct" | "partial" | "incorrect";
export function mean(xs: number[]): number | null;
