import {
  APIConnectionError,
  APIError,
  ConnectAccountError,
  FileTooLargeError,
  LigaX,
  MAX_FILE_BYTES,
  TimeoutError,
  TextAssembler,
  cachedTokenProvider,
  connectAccount,
  type ConnectSession,
  type Fetch,
  type RunEvent,
  type RunStream,
} from '@ligaxai/sdk';

import { renderMarkdown } from './markdown.js';
import { readStorage, tokenFetcher, writeStorage, type MintedToken } from './session.js';
import { STYLES } from './styles.js';

export const TAG_NAME = 'ligax-chat';

/** Attributes `<ligax-chat>` reads. Changing one after the first message resets the session. */
export const OBSERVED_ATTRIBUTES = [
  'publishable-key',
  'profile-id',
  'token-url',
  'base-url',
  'chat-title',
  'greeting',
  'placeholder',
  'position',
  'open',
  'connectors',
  'files',
] as const;

/** The API attaches at most this many files to one run. */
const MAX_ATTACHMENTS = 10;

/** The element's public surface, also what `mount()` returns. */
export interface LigaXChatElement extends HTMLElement {
  /** Inject a `fetch` (tests, proxies). Set before the first message. */
  fetch: Fetch | undefined;
  /** Show the panel and move focus into it. */
  show(): void;
  /** Hide the panel and return focus to the launcher. */
  hide(): void;
  toggle(): void;
  /** Send a message as if the visitor typed it. Resolves when the reply has finished. */
  send(text: string): Promise<void>;
  /** Forget the conversation (a new one starts with the next message). */
  reset(): void;
}

/** A file picked for the next message: uploading, or uploaded with its `file_…` id. */
interface Attachment {
  name: string;
  id: string | undefined;
  chip: HTMLElement;
}

interface Pending {
  runId: string;
  interruptId: string;
  kind: string;
  prompt: string;
  preview: string | null;
}

const ATTACH_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';

const LAUNCHER_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

// Static markup only — nothing here comes from an attribute or the model. Text that does (title,
// greeting, answers) is set with textContent or built by renderMarkdown.
const TEMPLATE = `
<button class="launcher" type="button" aria-expanded="false" aria-controls="panel" aria-label="Open chat">${LAUNCHER_ICON}</button>
<section class="panel" id="panel" role="dialog" aria-labelledby="title" hidden>
  <header><h2 id="title"></h2><button class="close" type="button" aria-label="Close chat">×</button></header>
  <div class="connect" role="group" aria-labelledby="connect-title" hidden>
    <p id="connect-title">Connect your account</p>
    <div class="connect-buttons"></div>
    <p class="connect-status" role="status"></p>
  </div>
  <div class="log" role="log" aria-live="polite" aria-relevant="additions text"></div>
  <div class="sr" aria-live="polite" data-activity></div>
  <div class="attachments" hidden>
    <ul class="chips" aria-label="Attached files"></ul>
    <p class="attach-status" role="status"></p>
  </div>
  <form>
    <button class="attach" type="button" aria-label="Attach a file" hidden>${ATTACH_ICON}</button>
    <input class="file" type="file" multiple tabindex="-1" aria-hidden="true" hidden>
    <label class="sr" for="input">Message</label>
    <textarea id="input" rows="1" autocomplete="off"></textarea>
    <button class="send" type="submit">Send</button>
  </form>
</section>`;

let elementClass: (new () => LigaXChatElement) | undefined;

/**
 * The element class, created on first use: `HTMLElement` does not exist during server rendering,
 * so a class that extends it at module scope would break any SSR import of this package.
 */
export function getElementClass(): new () => LigaXChatElement {
  if (elementClass) return elementClass;

  class Element extends HTMLElement implements LigaXChatElement {
    static get observedAttributes(): readonly string[] {
      return OBSERVED_ATTRIBUTES;
    }

    fetch: Fetch | undefined;

    private readonly root: ShadowRoot;
    private readonly launcher: HTMLButtonElement;
    private readonly panel: HTMLElement;
    private readonly heading: HTMLElement;
    private readonly log: HTMLElement;
    private readonly activity: HTMLElement;
    private readonly form: HTMLFormElement;
    private readonly input: HTMLTextAreaElement;
    private readonly sendButton: HTMLButtonElement;
    private readonly connectArea: HTMLElement;
    private readonly connectButtons: HTMLElement;
    private readonly connectStatus: HTMLElement;
    private readonly attachButton: HTMLButtonElement;
    private readonly fileInput: HTMLInputElement;
    private readonly attachArea: HTMLElement;
    private readonly chips: HTMLElement;
    private readonly attachStatus: HTMLElement;

    private client: LigaX | undefined;
    private profileId: string | undefined;
    private busy = false;
    private active: RunStream | undefined;
    private greeted = false;
    /** The profile does not let end users connect accounts (409): the area stays hidden. */
    private connectOff = false;
    private connecting: AbortController | undefined;
    private readonly connected = new Set<string>();
    /** Files for the next message, in the order picked. Cleared once a run accepts them. */
    private attachments: Attachment[] = [];
    private uploading = 0;

    constructor() {
      super();
      this.root = this.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = STYLES;
      const template = document.createElement('template');
      template.innerHTML = TEMPLATE;
      this.root.append(style, template.content.cloneNode(true));
      const $ = <T extends HTMLElement>(selector: string) => this.root.querySelector<T>(selector)!;
      this.launcher = $('.launcher');
      this.panel = $('.panel');
      this.heading = $('h2');
      this.log = $('.log');
      this.activity = $('[data-activity]');
      this.form = $('form');
      this.input = $('textarea');
      this.sendButton = $('.send');
      this.connectArea = $('.connect');
      this.connectButtons = $('.connect-buttons');
      this.connectStatus = $('.connect-status');
      this.attachButton = $('.attach');
      this.fileInput = $('.file');
      this.attachArea = $('.attachments');
      this.chips = $('.chips');
      this.attachStatus = $('.attach-status');

      this.launcher.addEventListener('click', () => this.toggle());
      $('.close').addEventListener('click', () => this.hide());
      this.panel.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          this.hide();
        }
      });
      this.input.addEventListener('keydown', (event) => {
        // Enter sends, Shift+Enter is a new line; never while an IME is composing.
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          this.form.requestSubmit();
        }
      });
      this.attachButton.addEventListener('click', () => this.fileInput.click());
      this.fileInput.addEventListener('change', () => {
        const picked = [...(this.fileInput.files ?? [])];
        // Reset so picking the same file again still fires `change`.
        this.fileInput.value = '';
        void this.attach(picked);
      });
      this.form.addEventListener('submit', (event) => {
        event.preventDefault();
        const text = this.input.value;
        if (!text.trim() || this.busy || this.uploading > 0) return;
        this.input.value = '';
        void this.send(text);
      });
    }

    connectedCallback(): void {
      this.render();
    }

    disconnectedCallback(): void {
      this.active?.abort();
      this.connecting?.abort();
    }

    attributeChangedCallback(name: string, previous: string | null, next: string | null): void {
      if (previous === next) return;
      if (['publishable-key', 'profile-id', 'token-url', 'base-url'].includes(name)) {
        this.client = undefined;
        this.connectOff = false;
        this.connected.clear();
        this.clearAttachments();
      }
      if (this.isConnected) this.render();
    }

    show(): void {
      this.panel.hidden = false;
      this.launcher.setAttribute('aria-expanded', 'true');
      this.launcher.setAttribute('aria-label', 'Close chat');
      this.greet();
      this.input.focus();
    }

    hide(): void {
      const hadFocus =
        this.root.activeElement !== null && this.root.activeElement !== this.launcher;
      this.panel.hidden = true;
      this.launcher.setAttribute('aria-expanded', 'false');
      this.launcher.setAttribute('aria-label', 'Open chat');
      if (hadFocus) this.launcher.focus();
    }

    toggle(): void {
      if (this.panel.hidden) this.show();
      else this.hide();
    }

    reset(): void {
      writeStorage('session', this.conversationKey(), null);
      this.log.replaceChildren();
      this.greeted = false;
      this.greet();
    }

    async send(text: string): Promise<void> {
      const message = text.trim();
      if (!message || this.busy || this.uploading > 0) return;
      this.setBusy(true);
      const attached = this.attachments.filter((a) => a.id !== undefined);
      const userBubble = this.addMessage('user');
      userBubble.textContent = message;
      if (attached.length) {
        const names = document.createElement('div');
        names.className = 'msg-files';
        names.textContent = attached.map((a) => a.name).join(', ');
        userBubble.appendChild(names);
      }
      const bubble = this.addMessage('assistant');
      bubble.setAttribute('aria-busy', 'true');
      try {
        await this.turn(
          message,
          attached.map((a) => a.id!),
          bubble,
          true,
        );
      } catch (error) {
        this.fail(bubble, error);
      } finally {
        bubble.setAttribute('aria-busy', 'false');
        this.setActivity('');
        this.setBusy(false);
      }
    }

    // ── a turn ────────────────────────────────────────────────────────────────────────────────

    private async turn(
      message: string,
      attachments: string[],
      bubble: HTMLElement,
      mayRetry: boolean,
    ): Promise<void> {
      const client = this.ensureClient();
      if (!this.profileId) {
        // A token URL may be the only thing that knows the profile: fetching the token tells us.
        await this.tokenProvider?.({ refresh: false });
      }
      if (!this.profileId) throw new TypeError('@ligaxai/widget: no profile id.');
      const conversationId = readStorage('session', this.conversationKey()) ?? undefined;
      let stream: RunStream;
      try {
        stream = await client.runs.stream({
          profile_id: this.profileId,
          input: message,
          ...(conversationId ? { conversation_id: conversationId } : {}),
          ...(attachments.length ? { attachments } : {}),
        });
      } catch (error) {
        // A file that expired or was deleted is not the conversation's fault: drop the files (the
        // visitor attaches again) and keep the conversation.
        if (error instanceof APIError && error.code === 'file_not_found') {
          this.clearAttachments();
          throw error;
        }
        // A conversation id from an earlier token (another visitor id, a deleted conversation) is
        // not this user's any more: start a new conversation once rather than fail forever.
        if (mayRetry && conversationId && error instanceof APIError && error.status === 404) {
          writeStorage('session', this.conversationKey(), null);
          return this.turn(message, attachments, bubble, false);
        }
        throw error;
      }
      // The run has the files now; the next message starts with none.
      if (attachments.length) this.clearAttachments();
      if (stream.conversationId) {
        writeStorage('session', this.conversationKey(), stream.conversationId);
      }
      await this.follow(stream, bubble, new TextAssembler());
    }

    /** Render one stream into the bubble; on an interrupt, ask and follow the resumed run. */
    private async follow(
      stream: RunStream,
      bubble: HTMLElement,
      assembler: TextAssembler,
    ): Promise<void> {
      this.active = stream;
      const tools = new Map<string, string>();
      let lastSeq = 0;
      let pending: Pending | undefined;
      let failed: string | undefined;
      const runId = stream.runId;
      try {
        for await (const event of stream) {
          if (typeof event.seq === 'number') lastSeq = Math.max(lastSeq, event.seq);
          if (assembler.apply(event)) this.paint(bubble, assembler.text());
          this.onEvent(event, tools);
          if (event.type === 'interrupt.raised' && runId) {
            pending = toPending(runId, event, tools);
          } else if (event.type === 'run.end') {
            const status = event.payload['status'];
            if (status === 'failed') failed = errorMessage(event.payload['error']);
          }
        }
      } finally {
        this.active = undefined;
      }
      this.paint(bubble, assembler.text());
      if (failed !== undefined) throw new RunFailed(failed);
      if (!pending) return;
      // An anonymous visitor can't answer approvals (the API refuses with 403
      // approval_not_allowed): the site's team answers from their server, and the run waits.
      if (this.isVisitor()) {
        this.notice(
          'This needs approval from the team before the assistant can go on. Check back later for the answer.',
        );
        this.setActivity('');
        return;
      }

      const decision = await this.ask(pending);
      this.setActivity(decision === 'approve' ? 'Approved. Continuing…' : 'Declined.');
      const client = this.ensureClient();
      try {
        await client.runs.resolveInterrupt(pending.runId, pending.interruptId, { decision });
      } catch (error) {
        // The assistant's approvals are answered by the site's server (the profile's setting), not
        // from the browser: say so plainly instead of showing an error.
        if (error instanceof APIError && error.code === 'approval_not_allowed') {
          this.setActivity('');
          this.notice(
            'This needs approval from the team before the assistant can go on. Check back later for the answer.',
          );
          return;
        }
        throw error;
      }
      const resumed = await client.runs.followEvents(pending.runId, { after: lastSeq });
      await this.follow(resumed, bubble, assembler);
    }

    private onEvent(event: RunEvent, tools: Map<string, string>): void {
      const p = event.payload;
      if (event.type === 'tool.start') {
        const name = typeof p['name'] === 'string' ? p['name'] : 'a tool';
        if (typeof p['tool_call_id'] === 'string') tools.set(p['tool_call_id'], name);
        this.setActivity(`Using ${humanise(name)}…`);
      } else if (event.type === 'tool.end' || event.type === 'run.end') {
        this.setActivity('');
      }
    }

    /** The approval card: resolves with the visitor's decision. */
    private ask(pending: Pending): Promise<'approve' | 'reject'> {
      const card = document.createElement('div');
      card.className = 'card';
      card.setAttribute('role', 'group');
      card.setAttribute('aria-label', 'Approval needed');
      const prompt = document.createElement('p');
      prompt.textContent = pending.prompt;
      card.appendChild(prompt);
      if (pending.preview) {
        const preview = document.createElement('p');
        preview.className = 'preview';
        preview.textContent = pending.preview;
        card.appendChild(preview);
      }
      const actions = document.createElement('div');
      actions.className = 'actions';
      const approval = pending.kind === 'tool_approval';
      const approve = document.createElement('button');
      approve.type = 'button';
      approve.className = 'approve';
      approve.textContent = 'Approve';
      const reject = document.createElement('button');
      reject.type = 'button';
      reject.className = 'reject';
      reject.textContent = approval ? 'Reject' : 'Dismiss';
      // Only a tool approval can be approved from here; a form or a question is declined.
      if (approval) actions.appendChild(approve);
      actions.appendChild(reject);
      card.appendChild(actions);
      this.log.appendChild(card);
      this.scrollToEnd();
      (approval ? approve : reject).focus();

      return new Promise((resolve) => {
        const decide = (decision: 'approve' | 'reject') => {
          approve.disabled = true;
          reject.disabled = true;
          const outcome = document.createElement('p');
          outcome.className = 'preview';
          outcome.textContent = decision === 'approve' ? 'Approved.' : 'Declined.';
          actions.replaceWith(outcome);
          this.input.focus();
          resolve(decision);
        };
        approve.addEventListener('click', () => decide('approve'), { once: true });
        reject.addEventListener('click', () => decide('reject'), { once: true });
      });
    }

    // ── plumbing ──────────────────────────────────────────────────────────────────────────────

    private tokenProvider: ReturnType<typeof cachedTokenProvider> | undefined;

    private ensureClient(): LigaX {
      if (this.client) return this.client;
      this.profileId = this.getAttribute('profile-id') ?? undefined;
      const tokenUrl = this.getAttribute('token-url') ?? undefined;
      const baseURL = this.getAttribute('base-url') ?? undefined;
      const fetcher = tokenFetcher(
        {
          publishableKey: this.getAttribute('publishable-key') ?? undefined,
          profileId: this.profileId,
          tokenUrl,
          baseURL,
          fetch: this.fetch,
        },
        (minted: MintedToken) => {
          if (!this.profileId && minted.profile_id) this.profileId = minted.profile_id;
        },
      );
      this.tokenProvider = cachedTokenProvider(fetcher);
      this.client = new LigaX({ apiKey: this.tokenProvider, baseURL, fetch: this.fetch });
      return this.client;
    }

    /** An anonymous website visitor: a website key and no token route for a signed-in user. */
    private isVisitor(): boolean {
      return this.hasAttribute('publishable-key') && !this.hasAttribute('token-url');
    }

    /** A plain note in the conversation; text only. */
    private notice(text: string): void {
      const note = document.createElement('p');
      note.className = 'card';
      note.setAttribute('role', 'status');
      note.textContent = text;
      this.log.appendChild(note);
      this.log.scrollTop = this.log.scrollHeight;
    }

    private conversationKey(): string {
      const scope = this.getAttribute('profile-id') ?? this.getAttribute('token-url') ?? 'default';
      return `ligax.conversation.${scope}`;
    }

    private render(): void {
      this.heading.textContent = this.getAttribute('chat-title') || 'Chat';
      this.input.placeholder = this.getAttribute('placeholder') || 'Type a message…';
      const files = this.getAttribute('files');
      // Anonymous visitors chat only: uploads and account connections need a signed-in user's token.
      this.attachButton.hidden = files === null || files === 'false' || this.isVisitor();
      if (this.attachButton.hidden) this.clearAttachments();
      if (this.hasAttribute('open') && this.panel.hidden) this.show();
      this.renderConnectors();
    }

    // ── files attached to the next message ────────────────────────────────────────────────────

    /**
     * Upload each picked file with the widget's own client token (scope `files:write`, so the file
     * belongs to this visitor and only their runs can attach it). One at a time, so a slow upload
     * never races the next; Send waits until they are all in.
     */
    private async attach(files: File[]): Promise<void> {
      if (files.length === 0) return;
      this.attachStatus.textContent = '';
      let client: LigaX;
      try {
        client = this.ensureClient();
      } catch (error) {
        this.showAttachStatus(friendlyError(error, !!this.getAttribute('token-url')));
        return;
      }
      for (const file of files) {
        if (this.attachments.length >= MAX_ATTACHMENTS) {
          this.showAttachStatus(`You can attach up to ${MAX_ATTACHMENTS} files to a message.`);
          break;
        }
        if (file.size > MAX_FILE_BYTES) {
          this.showAttachStatus(`${file.name} is too large. Files can be up to 25 MB.`);
          continue;
        }
        const attachment = this.addChip(file.name);
        this.uploading += 1;
        this.syncSendButton();
        try {
          const saved = await client.files.create(file);
          attachment.id = saved.id;
          this.paintChip(attachment);
        } catch (error) {
          this.removeAttachment(attachment);
          this.showAttachStatus(
            `${file.name} could not be attached. ${friendlyError(error, !!this.getAttribute('token-url'))}`,
          );
        } finally {
          this.uploading -= 1;
          this.syncSendButton();
        }
      }
    }

    /** A chip per file, built with DOM calls; the name only ever reaches `textContent`. */
    private addChip(name: string): Attachment {
      const chip = document.createElement('li');
      const attachment: Attachment = { name, id: undefined, chip };
      this.attachments.push(attachment);
      this.paintChip(attachment);
      this.chips.appendChild(chip);
      this.attachArea.hidden = false;
      return attachment;
    }

    private paintChip(attachment: Attachment): void {
      const label = document.createElement('span');
      label.textContent = attachment.id ? attachment.name : `${attachment.name} (uploading…)`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${attachment.name}`);
      remove.disabled = !attachment.id;
      remove.addEventListener('click', () => {
        // The uploaded file stays until it expires; it just is not sent with this message.
        this.removeAttachment(attachment);
        this.input.focus();
      });
      attachment.chip.replaceChildren(label, remove);
    }

    private removeAttachment(attachment: Attachment): void {
      this.attachments = this.attachments.filter((a) => a !== attachment);
      attachment.chip.remove();
      this.attachArea.hidden = this.attachments.length === 0 && !this.attachStatus.textContent;
    }

    private clearAttachments(): void {
      this.attachments = [];
      this.chips.replaceChildren();
      this.attachStatus.textContent = '';
      this.attachArea.hidden = true;
    }

    private showAttachStatus(text: string): void {
      this.attachStatus.textContent = text;
      this.attachArea.hidden = false;
    }

    // ── end users connecting their own accounts ───────────────────────────────────────────────

    private connectorKeys(): string[] {
      const raw = this.getAttribute('connectors') ?? '';
      const keys = raw
        .split(',')
        .map((key) => key.trim())
        .filter((key) => /^[a-z0-9][a-z0-9_.-]{0,63}$/i.test(key));
      return [...new Set(keys)];
    }

    /** One button per connector key; built with DOM calls, labels from textContent only. */
    private renderConnectors(): void {
      const keys = this.connectOff || this.isVisitor() ? [] : this.connectorKeys();
      this.connectArea.hidden = keys.length === 0;
      const buttons = keys.map((key) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset['connector'] = key;
        this.paintConnectButton(button, key);
        button.addEventListener('click', () => this.connect(key));
        return button;
      });
      this.connectButtons.replaceChildren(...buttons);
    }

    private paintConnectButton(button: HTMLButtonElement, key: string): void {
      const done = this.connected.has(key);
      button.textContent = done ? `${connectorName(key)} connected` : connectorName(key);
      button.setAttribute(
        'aria-label',
        done ? `${connectorName(key)} connected` : `Connect ${connectorName(key)}`,
      );
      button.disabled = done || this.connecting !== undefined;
    }

    private setConnectButtonsDisabled(): void {
      for (const button of this.connectButtons.querySelectorAll('button')) {
        this.paintConnectButton(button, button.dataset['connector'] ?? '');
      }
    }

    /**
     * Runs inside the button's click handler and reaches `connectAccount()` without an await, so the
     * browser treats the popup as user-initiated.
     */
    private connect(key: string): void {
      if (this.connecting) return;
      let client: LigaX;
      try {
        client = this.ensureClient();
      } catch (error) {
        this.connectStatus.textContent = friendlyError(error, !!this.getAttribute('token-url'));
        return;
      }
      const controller = new AbortController();
      this.connecting = controller;
      this.setConnectButtonsDisabled();
      this.connectStatus.textContent = `Connecting ${connectorName(key)}…`;
      void connectAccount(client, { connectorKey: key, signal: controller.signal })
        .then((session) => this.connectSettled(key, session, undefined))
        .catch((error: unknown) => this.connectSettled(key, undefined, error))
        .finally(() => {
          if (this.connecting === controller) this.connecting = undefined;
          this.setConnectButtonsDisabled();
        });
    }

    private connectSettled(key: string, session: ConnectSession | undefined, error: unknown): void {
      if (this.connecting?.signal.aborted) return;
      const name = connectorName(key);
      if (session?.status === 'succeeded') {
        this.connected.add(key);
        this.connectStatus.textContent = `${name} is connected.`;
        return;
      }
      if (error instanceof APIError && error.code === 'end_user_connections_off') {
        this.connectOff = true;
        this.connectStatus.textContent = '';
        this.renderConnectors();
        return;
      }
      this.connectStatus.textContent = connectFailure(name, session, error, () =>
        friendlyError(error, !!this.getAttribute('token-url')),
      );
    }

    private greet(): void {
      const greeting = this.getAttribute('greeting');
      if (this.greeted || !greeting) return;
      this.greeted = true;
      const bubble = this.addMessage('assistant');
      bubble.textContent = greeting;
    }

    private addMessage(kind: 'user' | 'assistant' | 'error'): HTMLElement {
      const el = document.createElement('div');
      el.className = `msg ${kind}`;
      this.log.appendChild(el);
      this.scrollToEnd();
      return el;
    }

    private paint(bubble: HTMLElement, text: string): void {
      bubble.replaceChildren(renderMarkdown(text));
      this.scrollToEnd();
    }

    private fail(bubble: HTMLElement, error: unknown): void {
      if (!bubble.textContent) bubble.remove();
      const el = this.addMessage('error');
      el.setAttribute('role', 'alert');
      el.textContent = friendlyError(error, !!this.getAttribute('token-url'));
    }

    private setActivity(text: string): void {
      this.activity.textContent = text;
      let line = this.log.querySelector<HTMLElement>('.activity');
      if (!text) {
        line?.remove();
        return;
      }
      if (!line) {
        line = document.createElement('div');
        line.className = 'activity';
        line.setAttribute('aria-hidden', 'true');
      }
      line.textContent = text;
      this.log.appendChild(line);
      this.scrollToEnd();
    }

    private setBusy(busy: boolean): void {
      this.busy = busy;
      this.syncSendButton();
    }

    private syncSendButton(): void {
      this.sendButton.disabled = this.busy || this.uploading > 0;
      this.attachButton.disabled = this.busy;
    }

    private scrollToEnd(): void {
      this.log.scrollTop = this.log.scrollHeight;
    }
  }

  elementClass = Element;
  return Element;
}

/** Register `<ligax-chat>` once. Safe to call repeatedly and during server rendering (no-op). */
export function define(): void {
  if (typeof customElements === 'undefined') return;
  if (!customElements.get(TAG_NAME)) customElements.define(TAG_NAME, getElementClass());
}

class RunFailed extends Error {}

function toPending(runId: string, event: RunEvent, tools: Map<string, string>): Pending {
  const p = event.payload;
  const callId = typeof p['tool_call_id'] === 'string' ? p['tool_call_id'] : '';
  const call = p['tool_call'];
  const nested =
    call && typeof call === 'object' ? (call as Record<string, unknown>)['tool_name'] : undefined;
  const tool =
    (typeof p['tool_name'] === 'string' && p['tool_name']) ||
    (typeof nested === 'string' && nested) ||
    tools.get(callId) ||
    'an action';
  const kind = typeof p['kind'] === 'string' ? p['kind'] : 'tool_approval';
  const prompt =
    typeof p['prompt'] === 'string' && p['prompt']
      ? p['prompt']
      : `The assistant wants to use ${humanise(tool)}. Allow it?`;
  const preview = typeof p['preview'] === 'string' ? p['preview'] : null;
  return {
    runId,
    interruptId: typeof p['interrupt_id'] === 'string' ? p['interrupt_id'] : '',
    kind,
    prompt,
    preview,
  };
}

/** Brand casings a split-and-capitalise would get wrong. */
const CONNECTOR_NAMES: Record<string, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  hubspot: 'HubSpot',
  servicenow: 'ServiceNow',
  sharepoint: 'SharePoint',
  onedrive: 'OneDrive',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
};

/** `google_calendar` → "Google Calendar", `gmail` → "Gmail". */
export function connectorName(key: string): string {
  const known = CONNECTOR_NAMES[key.toLowerCase()];
  if (known) return known;
  return key
    .split(/[_.-]+/)
    .filter(Boolean)
    .map((word) => CONNECTOR_NAMES[word.toLowerCase()] ?? word[0]!.toUpperCase() + word.slice(1))
    .join(' ');
}

function connectFailure(
  name: string,
  session: ConnectSession | undefined,
  error: unknown,
  fallback: () => string,
): string {
  if (session?.status === 'denied') return `${name} was not connected.`;
  if (session) return `Could not connect ${name}. Please try again.`;
  if (error instanceof ConnectAccountError) {
    if (error.reason === 'popup_blocked') return `Allow pop-ups for this site to connect ${name}.`;
    return `${name} was not connected.`;
  }
  if (error instanceof TimeoutError) return `Connecting ${name} took too long. Please try again.`;
  if (error instanceof APIError && error.status === 422) {
    return `${name} cannot be connected here.`;
  }
  return fallback();
}

function humanise(name: string): string {
  return name.replace(/[_.]+/g, ' ').trim();
}

function errorMessage(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message ? message : 'The assistant could not finish.';
}

/** What a visitor should read — never a stack trace, never a raw API body. */
export function friendlyError(error: unknown, signedInFlow: boolean): string {
  if (error instanceof RunFailed)
    return 'Sorry, something went wrong while answering. Please try again.';
  if (error instanceof FileTooLargeError) return 'Files can be up to 25 MB.';
  if (error instanceof APIError && error.code === 'file_not_found') {
    return 'An attached file is no longer available. Please attach it again.';
  }
  if (error instanceof APIError) {
    switch (error.status) {
      case 401:
        return signedInFlow
          ? 'Please sign in to chat.'
          : 'Your chat session has ended. Reload the page to continue.';
      case 413:
        return 'Files can be up to 25 MB.';
      case 402:
        return 'This assistant is unavailable right now. Please try again later.';
      case 403:
        if (error.code === 'origin_not_allowed') return 'Chat is not enabled for this website.';
        if (error.code === 'end_user_required') return 'Please sign in to chat.';
        return 'This assistant cannot help with that here.';
      case 429:
        return 'You are sending messages too quickly. Please wait a moment and try again.';
      default:
        return 'Something went wrong. Please try again.';
    }
  }
  if (error instanceof APIConnectionError) {
    return 'Could not reach the assistant. Check your connection and try again.';
  }
  return 'Something went wrong. Please try again.';
}
