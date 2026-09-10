window.__ModuleLoader__.load({
	id: "dsh-ui-tweaks",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_dom_client = require("react-dom/client");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0dsh-css:src/client/mobile-sidebar.css.mjs
		const css$1 = "/**\n * Narrow-screen drawer for the host left sidebar (see mobile-sidebar.tsx).\n * Every rule is gated to max-width: 767px (NARROW_MAX_WIDTH in the module):\n * at ≥768px the host's native rail / wide sidebar keeps its behavior and the\n * trigger + scrim are hidden. Selectors are plugin-owned data attributes\n * plus the host frame's own `data-sidebar-collapsed` state — no hashed\n * classes, no host changes.\n */\n\n/* The trigger + scrim mount on every width but render only on phones. */\n@media (min-width: 768px) {\n  [data-dsh-mobile-sidebar-root] {\n    display: none;\n  }\n}\n\n[data-dsh-mobile-trigger] {\n  position: fixed;\n  top: max(8px, env(safe-area-inset-top, 0px));\n  left: max(8px, env(safe-area-inset-left, 0px));\n  z-index: 61;\n  width: 42px;\n  height: 42px;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  padding: 0;\n  border-radius: 12px;\n  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08));\n  background: var(--dsw-alias-button-elevated-fill, #ffffff);\n  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.14);\n  color: var(--dsw-alias-label-primary, #1a1a1a);\n  cursor: pointer;\n}\n\n[data-dsh-mobile-trigger]:hover {\n  background: var(--dsw-alias-button-floating-hover, #f0f1f3);\n}\n\n/* The better-sidebar right panel (phones collapse its two panels into\n   the one right panel) is open exactly while `body` lacks\n   data-dsh-sidebar-collapsed — that plugin mirrors its panelOpen onto\n   body. The open panel covers the whole phone viewport and the floating\n   whale trigger would hover over its top-left corner, so hide the\n   trigger in that state (it only floats above the conversation). */\nbody:not([data-dsh-sidebar-collapsed]) [data-dsh-mobile-trigger] {\n  display: none;\n}\n\n[data-dsh-mobile-scrim] {\n  position: fixed;\n  inset: 0;\n  z-index: 59;\n  /* Below the drawer (60) and the trigger (61): the drawer stays fully\n     interactive while the scrim only dims + catches clicks on the\n     conversation outside the drawer. */\n  display: none;\n  padding: 0;\n  border: 0;\n  background: rgba(0, 0, 0, 0.36);\n  cursor: pointer;\n}\n\n/* The scrim shows only while the drawer is open (mirrors the frame's\n   collapsed attribute; set by the module's attribute observer). */\n[data-dsh-mobile-sidebar-root][data-dsh-mobile-open='true'] [data-dsh-mobile-scrim] {\n  display: block;\n}\n\n/* Soft fade under the top edge: with the session header hidden the flow\n   scrolls flush to the screen edge; this translucent gradient (the host's\n   page-background token, light #fff / dark #151517) gives the top a\n   gentle boundary — content sinks beneath it as it scrolls — without\n   blocking any interaction. The gradient follows the host theme through\n   --dsw-alias-bg-base (the host flips `color-scheme` and the\n   --dsw-alias-* tokens with prefers-color-scheme), and color-mix builds\n   the 85% stop so no hardcoded white survives in dark mode. The first\n   declaration is the pre-color-mix fallback for older engines.\n   z-index 35: above the app's in-flow content (auto), but below the\n   better-sidebar overlay layer (data-dsh-panel-host, z 40) so the\n   panel's top buttons/sidebar are never washed out, and below the\n   scrim (59), the drawer (60) and the trigger (61). Hidden on desktop\n   together with the root. */\n[data-dsh-mobile-top-fade] {\n  position: fixed;\n  top: 0;\n  left: 0;\n  right: 0;\n  height: calc(72px + env(safe-area-inset-top, 0px));\n  z-index: 35;\n  pointer-events: none;\n  background: linear-gradient(to bottom, rgba(255, 255, 255, 0.98) 0%, rgba(255, 255, 255, 0.85) 38%, rgba(255, 255, 255, 0) 100%);\n  background: linear-gradient(to bottom, var(--dsw-alias-bg-base, #ffffff) 0%, color-mix(in srgb, var(--dsw-alias-bg-base, #ffffff) 85%, transparent) 38%, transparent 100%);\n}\n\n/* While the drawer is open the fade is redundant — the scrim dims the\n   remainder and the drawer is its own surface — and its white wash\n   covers the drawer's head controls, so hide it in that state. */\n[data-dsh-mobile-sidebar-root][data-dsh-mobile-open='true'] [data-dsh-mobile-top-fade] {\n  display: none;\n}\n\n@media (max-width: 767px) {\n  /* Zero the sidebar's grid track: the column occupies no width and the\n     conversation takes the full viewport. The frame sets its track inline,\n     so the override needs !important. */\n  [data-dsh-mobile-frame] {\n    grid-template-columns: 0 minmax(0, 1fr) 0 !important;\n  }\n\n  /* Pin every column to its own grid line. Without this, hiding the sidebar\n     column (display:none) or turning it into the fixed drawer (position:\n     fixed) removes it from the grid flow, and CSS auto-placement then shifts\n     the center column into the zero-width first track (invisible) while the\n     details column lands in the full-width middle track — the message flow\n     disappears and only the details panel shows. */\n  [data-dsh-mobile-frame] [data-dsh-mobile-sidebar-col] {\n    grid-column: 1 / 2;\n  }\n\n  [data-dsh-mobile-frame] [data-dsh-mobile-center-col] {\n    grid-column: 2 / 3;\n  }\n\n  [data-dsh-mobile-frame] [data-dsh-mobile-details-col] {\n    grid-column: 3 / 4;\n  }\n\n  /* Collapsed (rail): the column is gone entirely; only the trigger shows. */\n  [data-dsh-mobile-frame][data-sidebar-collapsed] [data-dsh-mobile-sidebar-col] {\n    display: none;\n  }\n\n  /* Expanded: the column becomes a fixed overlay drawer over the\n     conversation. */\n  /* The drawer floats ABOVE the scrim (59) — the scrim would otherwise\n     swallow every click inside the drawer (it covers the whole viewport)\n     and the sidebar would feel dead; the trigger (61) stays on top so it\n     remains the close affordance over the open drawer. */\n  [data-dsh-mobile-frame]:not([data-sidebar-collapsed]) [data-dsh-mobile-sidebar-col] {\n    position: fixed;\n    top: 0;\n    bottom: 0;\n    left: 0;\n    width: 280px;\n    z-index: 60;\n    box-shadow: 8px 0 32px rgba(0, 0, 0, 0.28);\n    transform: translateX(-100%);\n    animation: dsh-mobile-drawer-in 220ms var(--ds-ease-in-out, ease) forwards;\n  }\n\n  /* The whole session header — title crumb, mode, the \"Session log\"\n     utility and the Chat/Trajectory tabs (host wSkVaW_header, reached\n     through its display:contents slot wrapper; the slot is the stable\n     seam) — is hidden on phones: it is pure chrome, the tabs have no\n     touch context, and it frees ~76px at the top for the message flow.\n     The floating whale trigger takes over the corner. The slot carries\n     an inline `display: contents` from the host, so the override needs\n     !important. */\n  [data-slot='conversation.session.header'] {\n    display: none !important;\n  }\n\n  /* Top clearance for the trigger at the very top of the flow: padding on\n     the scroll CONTENT (not the scroller) so it scrolls away — full\n     clearance only while scrollTop is 0, a normal gap otherwise. */\n  [data-dsh-mobile-frame] [data-chat-flow] {\n    padding-top: 56px;\n  }\n}\n\n@keyframes dsh-mobile-drawer-in {\n  from {\n    transform: translateX(-100%);\n  }\n  to {\n    transform: translateX(0);\n  }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  [data-dsh-mobile-frame]:not([data-sidebar-collapsed]) [data-dsh-mobile-sidebar-col] {\n    animation: none;\n  }\n}";
		const tagId$1 = "dsh-ui-tweaks/mobile-sidebar.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-ui-tweaks";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region src/client/mobile-sidebar.tsx
		/**
		* Narrow-screen sidebar drawer: on phone viewports the host's left sidebar
		* — including its collapsed 56px icon rail — is hidden entirely, and a
		* floating DeepSeek whale-logo trigger takes over the top-left corner.
		* Tapping it expands the sidebar through the layout service's official
		* toggle (`ctx.layout.toggleSidebar`), which flips the layout store's
		* `narrowExpanded` flag below the host's 1024px auto-collapse breakpoint;
		* CSS then turns the sidebar column into a fixed overlay drawer over the
		* conversation, backed by a full-screen scrim.
		*
		* Pure DOM + CSS against host facts — no harness changes:
		* - the AppFrame is stamped with plugin-owned data attributes once it
		*   appears (the frame carries `data-sidebar-collapsed` /
		*   `data-details-collapsed` or an inline three-track
		*   `gridTemplateColumns`; its grid children in DOM order are the sidebar,
		*   center, and details columns — verified against the served shell markup),
		* - every visual rule lives in `mobile-sidebar.css`, scoped to the stamped
		*   attributes + the frame's own `data-sidebar-collapsed` state and gated
		*   by a `max-width: 767px` media query (the same breakpoint
		*   dsh-better-sidebar uses; at ≥768px the host's native rail keeps its
		*   behavior and the trigger is hidden),
		* - React state only MIRRORS the frame's collapsed attribute (an attribute
		*   observer on the frame), so an expand triggered from anywhere stays in
		*   sync: open + scrim visibility follow the live host state.
		*/
		/** Marker stamped onto the host layout frame once (idempotent). */
		const MOBILE_FRAME_ATTR = "data-dsh-mobile-frame";
		/** Marker stamped onto the frame's first child, the sidebar column. */
		const MOBILE_SIDEBAR_COL_ATTR = "data-dsh-mobile-sidebar-col";
		/** Marker stamped onto the center (conversation) column. */
		const MOBILE_CENTER_COL_ATTR = "data-dsh-mobile-center-col";
		/** Marker stamped onto the details column. */
		const MOBILE_DETAILS_COL_ATTR = "data-dsh-mobile-details-col";
		/** The trigger/scrim host appended to <body>. */
		const MOBILE_ROOT_ATTR = "data-dsh-mobile-sidebar-root";
		/** Selectors identifying the live AppFrame element by its own attributes. */
		const FRAME_ATTRIBUTE_SELECTORS = [
			"[data-sidebar-collapsed]",
			"[data-details-collapsed]",
			"[data-dragging]"
		];
		/**
		* The AppFrame is the only element with an inline three-track grid matching
		* `<px> minmax(0, 1fr) <px>` (fallback when no collapse attribute is set —
		* e.g. details open on the desktop, which never happens on a phone width).
		*/
		function isFrameGrid(style) {
			return /px\s+minmax\(0,\s*1fr\)/.test(style.gridTemplateColumns);
		}
		/** Find the live AppFrame element (the layout div, not #root). */
		function findMobileFrame() {
			if (typeof document === "undefined") return void 0;
			for (const selector of FRAME_ATTRIBUTE_SELECTORS) {
				const element = document.querySelector(selector);
				if (element instanceof HTMLElement && element.firstElementChild !== null) return element;
			}
			const root = document.getElementById("root");
			if (root === null) return void 0;
			for (const element of root.querySelectorAll("div")) if (isFrameGrid(element.style)) return element;
		}
		/**
		* Stamp the frame and its three grid columns with plugin-owned markers.
		* The column marks are what let the stylesheet pin each column to a fixed
		* grid line: the sidebar column is hidden (collapsed) or turned into a
		* fixed drawer (expanded), and either state would otherwise pull the
		* remaining columns out of their tracks (CSS auto-placement skips items
		* that leave the flow), collapsing the conversation to zero width.
		* @returns true once the frame is stamped (either now or already).
		*/
		function stampMobileFrame() {
			const frame = findMobileFrame();
			if (frame === void 0) return false;
			frame.setAttribute(MOBILE_FRAME_ATTR, "");
			const columns = [
				MOBILE_SIDEBAR_COL_ATTR,
				MOBILE_CENTER_COL_ATTR,
				MOBILE_DETAILS_COL_ATTR
			];
			for (let index = 0; index < columns.length; index += 1) {
				const node = frame.children[index];
				if (node instanceof HTMLElement) node.setAttribute(columns[index], "");
			}
			return true;
		}
		/** The floating whale-logo trigger + the full-screen scrim. */
		function MobileSidebarShell({ open, label, onToggle }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					"data-dsh-mobile-trigger": "",
					"aria-label": label,
					title: label,
					"aria-expanded": open,
					onClick: onToggle,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.FishLogo, { size: 24 })
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					"data-dsh-mobile-scrim": "",
					"aria-hidden": "true",
					tabIndex: -1,
					onClick: onToggle
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					"data-dsh-mobile-top-fade": "",
					"aria-hidden": "true"
				})
			] });
		}
		/**
		* Mount the drawer into <body>. The trigger and scrim are fixed elements
		* hidden entirely at ≥768px by CSS; at phone widths the frame is stamped and
		* its collapsed attribute is mirrored onto the shell so the scrim shows only
		* while the drawer is open. The layout service is read per click so a late
		* service arrival still works.
		* @param options - toggle action + i18n label.
		* @returns a disposer (HMR-safe).
		*/
		function mountMobileSidebar(options) {
			const container = document.createElement("div");
			container.setAttribute(MOBILE_ROOT_ATTR, "");
			document.body.appendChild(container);
			const root = (0, react_dom_client.createRoot)(container);
			const isOpen = () => {
				const frame = findMobileFrame();
				return frame !== void 0 && frame.getAttribute("data-sidebar-collapsed") === null;
			};
			let open = isOpen();
			const render = () => {
				if (open) container.setAttribute("data-dsh-mobile-open", "true");
				else container.removeAttribute("data-dsh-mobile-open");
				root.render((0, react.createElement)(MobileSidebarShell, {
					open,
					label: options.label,
					onToggle: () => {
						options.toggleSidebar();
					}
				}));
			};
			let observer;
			const frameChange = () => {
				const next = isOpen();
				if (next !== open) {
					open = next;
					render();
				}
			};
			const watchFrame = (frame) => {
				observer?.disconnect();
				observer = new MutationObserver(frameChange);
				observer.observe(frame, {
					attributes: true,
					attributeFilter: ["data-sidebar-collapsed"]
				});
			};
			const bodyChange = () => {
				if (!stampMobileFrame()) return;
				observer?.disconnect();
				const frame = findMobileFrame();
				if (frame !== void 0) watchFrame(frame);
				frameChange();
			};
			try {
				observer = new MutationObserver(bodyChange);
				observer.observe(document.body, {
					childList: true,
					subtree: true
				});
			} catch {
				observer = void 0;
			}
			if (stampMobileFrame()) {
				const frame = findMobileFrame();
				if (frame !== void 0) watchFrame(frame);
			}
			render();
			return { dispose() {
				observer?.disconnect();
				root.unmount();
				container.remove();
			} };
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* `ui-tweaks` namespace dictionaries: the mobile drawer trigger copy.
		* Simplified Chinese is the key-set source of truth; English mirrors it.
		*/
		/** Simplified Chinese dictionary. */
		const zh = { "mobile.openSidebar": "打开侧边栏" };
		/** English dictionary (full mirror of the zh key set). */
		const en = { "mobile.openSidebar": "Open sidebar" };
		//#endregion
		//#region \0dsh-css:src/client/composer-toolbar.css.mjs
		const css = "/**\n * Narrow-screen composer toolbar: on phone viewports the input card's\n * bottom toolbar row (attach / access picker / model picker / send) has to\n * stay on one line. The host row is `flex-wrap: wrap` with a 12px gap:\n * at 320px the content area (~262px) is 2px short of the two groups, so\n * the trailing group (model + send) wraps to a second line and the card\n * grows from 42px to 82px tall. On phones we force single-line:\n * - tighten the row gap/padding so 320px fits in one line,\n * - pin the leading group (attach + access) so it never shrinks,\n * - let the trailing group shrink — its model picker already truncates\n *   with an ellipsis and still opens the full model list on tap, and the\n *   send button keeps its `flex-shrink: 0` so it always stays visible,\n * - overflow-x: clip as a last resort for sub-320px devices, trimming\n *   over-wide content (see the rule body for why it must be `clip` and\n *   never `auto`).\n *\n * Selectors are the composer card's hashed classes (uV2eYG_*), stable in\n * this frozen fork; the block is gated to max-width: 767px (same\n * breakpoint as mobile-sidebar.css) so ≥768px keeps the host's native\n * wrapping behavior untouched.\n */\n@media (max-width: 767px) {\n  .uV2eYG_row {\n    flex-wrap: nowrap !important;\n    gap: 8px !important;\n    padding: 2px 6px 6px !important;\n    /* `clip` (NOT auto/scroll): an auto/scroll X axis forces the Y axis\n       to `auto` as well (CSS overflow pairing), and the model / access /\n       context popups are absolutely positioned INSIDE this row and open\n       UP past its top edge — with overflow-y: auto they get clipped away\n       and the menus never appear on phones. `clip` scopes the clipping\n       to the horizontal axis only and keeps overflow-y: visible, so the\n       popups stay reachable while over-wide content is still trimmed. */\n    overflow-x: clip !important;\n  }\n\n  /* Leading group (attach + access): keep both affordances fully visible. */\n  .uV2eYG_tools {\n    flex: 0 0 auto !important;\n  }\n\n  /* Trailing group (model + send): allowed to shrink; the model picker\n     truncates instead of forcing the row to wrap. */\n  .uV2eYG_trailing {\n    flex: 0 1 auto !important;\n    min-width: 0 !important;\n  }\n}\n\n/**\n * Session stats row above the composer (host slot\n * `conversation.composer.dock`, class FJxK0a_*): the host lays five\n * `a | b` segments — turns, LLM/tool time, TTFT, token rate, token\n * usage — on one centered nowrap line (max-width 748px). On phones the\n * line overflows the dock width and reads as clipped text running off\n * the screen, and it eats valuable viewport space above the input; the\n * dock stats are redundant with the per-message hover info, so on\n * phones we hide the whole row.\n *\n * Message hover info in the action rows (class p-xYUq_*): the host\n * shows the message time (`p-xYUq_timeStart`) and the assistant-turn\n * summary `time · Ran for … · TTFT …` (`p-xYUq_timeEnd`) on hover —\n * an interaction phones don't have, and their wide text overflows the\n * narrow viewport. Hidden on phones; the action buttons stay.\n */\n@media (max-width: 767px) {\n  .FJxK0a_root {\n    display: none !important;\n  }\n\n  .p-xYUq_timeStart,\n  .p-xYUq_timeEnd {\n    display: none !important;\n  }\n}";
		const tagId = "dsh-ui-tweaks/composer-toolbar.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-ui-tweaks";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region src/client/index.ts
		/** Dictionary namespace owned by this plugin. */
		const NS = "ui-tweaks";
		/** Services required by this plugin. */
		const inject = ["locale"];
		/**
		* Mount the mobile tweaks. Each effect owns its whole lifecycle and is torn
		* down on fiber disposal (HMR-safe).
		*/
		function apply(ctx) {
			ctx.effect(() => {
				try {
					return ctx.locale.register(NS, {
						zh,
						en
					});
				} catch {
					return () => {};
				}
			}, "dsh-ui-tweaks: dictionaries");
			ctx.effect(() => {
				const disposeMobile = mountMobileSidebar({
					label: ctx.locale.bind(NS)("mobile.openSidebar"),
					toggleSidebar: () => {
						ctx.get("layout")?.toggleSidebar();
					}
				});
				return () => {
					disposeMobile.dispose();
				};
			}, "dsh-ui-tweaks: mobile sidebar drawer");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map