import { createStore } from '@bannertv/core';
import { SAMPLE_ITEMS, type SampleItem } from './sample-data';

/** The title the hero banner shows: whatever tile has focus. */
export const heroItem = createStore<SampleItem>(SAMPLE_ITEMS[0]!);
