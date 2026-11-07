import { boot } from './boot';

// Runs before the first screen is imported (see index.ts): the shared data layer decides the
// launch profile as it is imported, so storage has to be in place first.
boot();
