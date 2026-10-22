/**
 * Shadow-DOM styles. Every colour, radius and font is a custom property with a default, so a host
 * page themes the widget from outside without reaching into the shadow root:
 *
 *   ligax-chat { --ligax-accent: #7c3aed; --ligax-radius: 8px; }
 *
 * Outer-document rules on the host beat `:host` rules, which is exactly the precedence wanted here.
 * Dark mode follows `prefers-color-scheme`; the `-dark` variants override it per property.
 */
export const STYLES = `
:host{
  --_accent:var(--ligax-accent,#2563eb);
  --_accent-text:var(--ligax-accent-text,#fff);
  --_bg:var(--ligax-bg,#fff);
  --_surface:var(--ligax-surface,#f3f4f6);
  --_text:var(--ligax-text,#111827);
  --_muted:var(--ligax-muted,#6b7280);
  --_border:var(--ligax-border,rgba(0,0,0,.1));
  --_danger:var(--ligax-danger,#b91c1c);
  --_radius:var(--ligax-radius,14px);
  position:fixed;bottom:20px;right:20px;z-index:var(--ligax-z-index,2147483000);
  font:var(--ligax-font,14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif);
  color:var(--_text);
}
@media (prefers-color-scheme:dark){:host{
  --_bg:var(--ligax-bg-dark,#111827);
  --_surface:var(--ligax-surface-dark,#1f2937);
  --_text:var(--ligax-text-dark,#f9fafb);
  --_muted:var(--ligax-muted-dark,#9ca3af);
  --_border:var(--ligax-border-dark,rgba(255,255,255,.12));
  --_danger:var(--ligax-danger-dark,#fca5a5);
}}
:host([position="bottom-left"]){right:auto;left:20px}
*{box-sizing:border-box}
[hidden]{display:none!important}
button{font:inherit;cursor:pointer}
:focus-visible{outline:2px solid var(--_accent);outline-offset:2px}
.launcher{width:56px;height:56px;border:0;border-radius:50%;background:var(--_accent);color:var(--_accent-text);box-shadow:0 6px 24px rgba(0,0,0,.2);display:grid;place-items:center}
.launcher svg{width:26px;height:26px}
.panel{position:absolute;bottom:72px;right:0;width:min(380px,calc(100vw - 40px));height:min(560px,calc(100vh - 120px));display:flex;flex-direction:column;background:var(--_bg);border:1px solid var(--_border);border-radius:var(--_radius);box-shadow:0 12px 48px rgba(0,0,0,.22);overflow:hidden}
:host([position="bottom-left"]) .panel{right:auto;left:0}
header{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--_border)}
h2{flex:1;margin:0;font-size:15px;font-weight:600}
.close{border:0;background:transparent;color:var(--_muted);font-size:20px;line-height:1;width:32px;height:32px;border-radius:8px}
.log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}
.msg{max-width:88%;padding:9px 12px;border-radius:var(--_radius);word-wrap:break-word;overflow-wrap:anywhere}
.msg p{margin:0 0 .6em}.msg p:last-child{margin-bottom:0}
.msg code{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;background:rgba(127,127,127,.15);padding:1px 4px;border-radius:4px}
.msg pre{margin:0 0 .6em;padding:8px;overflow-x:auto;background:rgba(127,127,127,.15);border-radius:6px}
.msg pre code{background:none;padding:0}
.msg a{color:inherit;text-decoration:underline}
.user{align-self:flex-end;background:var(--_accent);color:var(--_accent-text);white-space:pre-wrap}
.assistant{align-self:flex-start;background:var(--_surface)}
.assistant[aria-busy="true"]:empty::after{content:"…";color:var(--_muted)}
.error{align-self:flex-start;background:transparent;color:var(--_danger);border:1px solid currentColor}
.activity{align-self:flex-start;color:var(--_muted);font-size:12.5px}
.card{align-self:stretch;border:1px solid var(--_border);border-radius:var(--_radius);padding:12px;display:flex;flex-direction:column;gap:8px;background:var(--_bg)}
.card p{margin:0}.card .preview{color:var(--_muted);font-size:12.5px;white-space:pre-wrap}
.actions{display:flex;gap:8px}
.actions button{padding:7px 14px;border-radius:8px;border:1px solid var(--_border);background:transparent;color:inherit}
.actions .approve{background:var(--_accent);color:var(--_accent-text);border-color:var(--_accent)}
.actions button:disabled{opacity:.5;cursor:default}
form{display:flex;gap:8px;padding:10px;border-top:1px solid var(--_border)}
textarea{flex:1;resize:none;max-height:120px;padding:8px 10px;border:1px solid var(--_border);border-radius:10px;font:inherit;color:inherit;background:transparent}
.send{padding:0 14px;border:0;border-radius:10px;background:var(--_accent);color:var(--_accent-text)}
.send:disabled{opacity:.5;cursor:default}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (prefers-reduced-motion:no-preference){.panel{animation:ligax-in .16s ease-out}}
@keyframes ligax-in{from{opacity:0;transform:translateY(8px)}}
`;
