// Entry for the IIFE build (`dist/widget.global.js`): exposes `window.LigaXWidget`, registers
// `<ligax-chat>` and mounts from the loading script's `data-*` attributes when they are present.
import { autoInit, define, mount } from './index.js';

export { autoInit, define, mount };
export type { LigaXChatElement, WidgetOptions } from './index.js';

define();
void autoInit();
