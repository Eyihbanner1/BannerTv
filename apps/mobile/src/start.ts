import { boot } from './boot';

// Runs before expo-router loads any screen (see index.ts): the shared data layer decides the
// launch profile as it is imported, so the phone's storage has to be in place first.
boot();
