import { createStore } from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';

/** The title the hero banner shows: whatever tile has focus, or Home's first title. */
export const heroItem = createStore<MetaPreview | null>(null);
