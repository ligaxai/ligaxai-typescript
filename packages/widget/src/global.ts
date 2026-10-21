// Entry for the IIFE build: exposes `window.BaseProjectWidget` and mounts automatically when the
// script tag carries `data-publishable-key` and `data-profile`.
import { autoInit, init } from './index.js';

export { autoInit, init };
export type { WidgetHandle, WidgetOptions, WidgetTheme } from './index.js';

autoInit();
