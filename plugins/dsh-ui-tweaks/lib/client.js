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
		//#region src/client/fold-chrome.ts
		/**
		* Fold chrome: the DOM observation + click delegation the driver needs.
		*
		* Watches <body> for `[data-chat-flow]` columns (added/removed at any depth),
		* attaches a childList observer to each live column so structural changes
		* (new rows, prepended history, remounts) re-trigger the fold pass, and
		* delegates clicks on「已处理」headers into the driver's toggle. All wiring is
		* tracked per container and torn down by the returned disposer (HMR-safe).
		*/
		/** Flow column marker (see ChatView's column div). */
		const FLOW_SELECTOR = "[data-chat-flow]";
		const HEADER_SELECTOR = "[data-dsh-fold-header]";
		function createFoldChrome(onChange, onHeaderClick) {
			const attached = /* @__PURE__ */ new Map();
			const attach = (container) => {
				if (attached.has(container)) return;
				const observer = new MutationObserver(onChange);
				observer.observe(container, { childList: true });
				const onClick = (event) => {
					const target = event.target;
					if (!(target instanceof Element)) return;
					const header = target.closest(HEADER_SELECTOR);
					if (header === null || !container.contains(header)) return;
					const turn = Number(header.getAttribute("data-dsh-fold-turn"));
					if (Number.isFinite(turn)) onHeaderClick(turn);
				};
				container.addEventListener("click", onClick);
				attached.set(container, {
					observer,
					onClick
				});
			};
			const detach = (container) => {
				const entry = attached.get(container);
				if (entry === void 0) return;
				entry.observer.disconnect();
				container.removeEventListener("click", entry.onClick);
				attached.delete(container);
			};
			const sync = () => {
				const visible = /* @__PURE__ */ new Set();
				for (const container of document.querySelectorAll(FLOW_SELECTOR)) {
					visible.add(container);
					attach(container);
				}
				for (const container of [...attached.keys()]) if (!visible.has(container)) detach(container);
			};
			const bodyObserver = new MutationObserver(() => {
				if (typeof document === "undefined") return;
				sync();
				onChange();
			});
			const start = () => {
				sync();
				if (typeof document !== "undefined" && document.body !== null) bodyObserver.observe(document.body, {
					childList: true,
					subtree: true
				});
				return () => {
					bodyObserver.disconnect();
					for (const container of [...attached.keys()]) detach(container);
				};
			};
			return {
				containers: () => [...attached.keys()],
				start
			};
		}
		//#endregion
		//#region src/client/fold-plan.ts
		/**
		* Pure fold-plan computation for the desktop chat flow.
		*
		* Given an immutable view of the current chat window (turns with their loaded
		* turn/start · turn/end boundaries plus the flow-ordered nodes), decides:
		*
		* - which completed, whole turns fold into a「已处理」block,
		* - which flow rows hide inside each fold (everything up to — but excluding —
		*   the turn's last assistant message, minus user/steering prompts), and
		* - whether the head of a closed turn sits outside the window, which means
		*   older history should be pulled so the turn can complete and fold.
		*
		* The desktop session window is contiguous, so a turn is *whole* exactly when
		* both its turn/start and turn/end events are loaded. A closed turn whose
		* turn/start is missing is a page-split turn: it must never be half-folded —
		* it stays unfolded until the head loads in (mirroring the mobile client's
		* "expand the load range to the turn boundary" fix).
		*/
		/** Prompt roles that a fold must never hide (the user's own words). */
		const PROMPT_KINDS = /* @__PURE__ */ new Set(["user", "steering"]);
		/** The chat-node kind of assistant message rows. */
		const ASSISTANT_KIND = "assistant-step";
		/** Compute the fold plan for one window pass. Pure — no side effects. */
		function planFolds(window) {
			const folds = [];
			let completionRequest = null;
			const byTurn = /* @__PURE__ */ new Map();
			for (const node of window.nodes) {
				if (node.turn === void 0) continue;
				const list = byTurn.get(node.turn);
				if (list === void 0) byTurn.set(node.turn, [node]);
				else list.push(node);
			}
			const turnNumbers = [...window.turns.keys()].sort((a, b) => a - b);
			for (const number of turnNumbers) {
				const t = window.turns.get(number);
				if (t === void 0) continue;
				if (!t.endLoaded) continue;
				if (!t.startLoaded) {
					if (completionRequest === null && window.hasMore && !window.loadingOlder) completionRequest = { turn: number };
					continue;
				}
				const nodes = byTurn.get(number) ?? [];
				const assistants = nodes.filter((n) => n.kind === ASSISTANT_KIND);
				if (assistants.length === 0) continue;
				const last = assistants.reduce((max, n) => n.anchorSeq > max.anchorSeq ? n : max, assistants[0]);
				const hiddenKeys = nodes.filter((n) => n.anchorSeq < last.anchorSeq && !PROMPT_KINDS.has(n.kind)).map((n) => n.key);
				folds.push({
					turn: number,
					hiddenKeys,
					lastAssistantKey: last.key,
					hiddenCount: hiddenKeys.length,
					...t.durationMs === void 0 ? {} : { durationMs: t.durationMs }
				});
			}
			return {
				folds,
				completionRequest
			};
		}
		//#endregion
		//#region src/client/fold-dom.ts
		/** Compact wall-clock duration: 3m16s / 45s / 1h02m (locale-neutral). */
		function formatDuration(ms) {
			const total = Math.max(0, Math.round(ms / 1e3));
			const hours = Math.floor(total / 3600);
			const minutes = Math.floor(total % 3600 / 60);
			const seconds = total % 60;
			if (hours > 0) return `${hours}h${String(minutes).padStart(2, "0")}m`;
			if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, "0")}s`;
			return `${seconds}s`;
		}
		/** CSS class / attribute vocabulary (plain CSS lives in fold.css, injected by the client entry). */
		const FOLD_HEADER_MARKER = "data-dsh-fold-header";
		const FOLD_TURN_ATTR = "data-dsh-fold-turn";
		const FOLD_ROW_ATTR = "data-dsh-fold-row";
		const FOLD_EXPANDED_ATTR = "data-dsh-fold-expanded";
		/** Marker on the fold's visible last reply (its think block hides while folded). */
		const FOLD_LAST_ATTR = "data-dsh-fold-last";
		const FOLD_LAST_EXPANDED_ATTR = "data-dsh-fold-last-expanded";
		function directRows(container) {
			const rows = /* @__PURE__ */ new Map();
			for (const child of container.children) {
				const el = child;
				const key = el.getAttribute("data-chat-flow-key");
				if (key !== null) rows.set(key, el);
			}
			return rows;
		}
		function directHeaders(container) {
			const headers = [];
			for (const child of container.children) {
				const el = child;
				if (el.hasAttribute("data-dsh-fold-header")) headers.push(el);
			}
			return headers;
		}
		function makeHeader(turn, open, copy) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "dsh-fold-header";
			button.setAttribute(FOLD_HEADER_MARKER, "");
			button.setAttribute(FOLD_TURN_ATTR, String(turn));
			button.setAttribute("aria-expanded", open ? "true" : "false");
			const caret = document.createElement("span");
			caret.className = "dsh-fold-caret";
			caret.textContent = "›";
			const label = document.createElement("span");
			label.className = "dsh-fold-label";
			label.textContent = copy.header();
			button.appendChild(label);
			button.appendChild(caret);
			return button;
		}
		/** Set or clear the header's count badge (shown only when rows were hidden). */
		function setCountBadge(button, count, copy) {
			const existing = button.querySelector(".dsh-fold-count");
			if (count <= 0) {
				existing?.remove();
				return;
			}
			if (existing === null) {
				const badge = document.createElement("span");
				badge.className = "dsh-fold-count";
				button.appendChild(badge);
				badge.textContent = copy.count(count);
			} else existing.textContent = copy.count(count);
		}
		/** Set or clear the header's duration badge (shown when the turn duration is known). */
		function setDurationBadge(button, durationMs, copy) {
			const existing = button.querySelector(".dsh-fold-duration");
			if (durationMs === void 0) {
				existing?.remove();
				return;
			}
			if (existing === null) {
				const badge = document.createElement("span");
				badge.className = "dsh-fold-duration";
				button.insertBefore(badge, button.querySelector(".dsh-fold-caret"));
				badge.textContent = copy.duration(durationMs);
			} else existing.textContent = copy.duration(durationMs);
		}
		/**
		* Apply one fold plan to a flow container. Pure DOM — no event wiring (the
		* driver owns the delegated click), no session reads.
		* @param container - the `[data-chat-flow]` column element.
		* @param plan - the current fold plan for the session.
		* @param expanded - turns currently expanded (user state, kept by the driver).
		* @param copy - translated header copy.
		*/
		function applyFoldPlan(container, plan, expanded, copy) {
			const rows = directRows(container);
			const foldedTurns = new Set(plan.folds.map((f) => f.turn));
			for (const header of directHeaders(container)) {
				const turn = Number(header.getAttribute(FOLD_TURN_ATTR));
				if (!foldedTurns.has(turn)) header.remove();
			}
			for (const row of rows.values()) {
				row.removeAttribute(FOLD_ROW_ATTR);
				row.removeAttribute(FOLD_EXPANDED_ATTR);
				row.removeAttribute(FOLD_LAST_ATTR);
				row.removeAttribute(FOLD_LAST_EXPANDED_ATTR);
			}
			for (const fold of plan.folds) {
				const lastRow = rows.get(fold.lastAssistantKey);
				if (lastRow === void 0) continue;
				const open = expanded.has(fold.turn);
				for (const key of fold.hiddenKeys) {
					const row = rows.get(key);
					if (row === void 0) continue;
					row.setAttribute(FOLD_ROW_ATTR, String(fold.turn));
					row.setAttribute(FOLD_EXPANDED_ATTR, open ? "true" : "false");
				}
				lastRow.setAttribute(FOLD_LAST_ATTR, String(fold.turn));
				lastRow.setAttribute(FOLD_LAST_EXPANDED_ATTR, open ? "true" : "false");
				const anchorRow = firstHiddenRow(container, fold.hiddenKeys) ?? lastRow;
				let header = directHeaders(container).find((h) => h.getAttribute(FOLD_TURN_ATTR) === String(fold.turn));
				if (header === void 0) {
					header = makeHeader(fold.turn, open, copy);
					anchorRow.parentNode?.insertBefore(header, anchorRow);
				} else {
					header.setAttribute("aria-expanded", open ? "true" : "false");
					const label = header.querySelector(".dsh-fold-label");
					if (label !== null) label.textContent = copy.header();
					if (header.nextElementSibling !== anchorRow) anchorRow.parentNode?.insertBefore(header, anchorRow);
				}
				setCountBadge(header, fold.hiddenCount, copy);
				setDurationBadge(header, fold.durationMs, copy);
			}
		}
		/** First row in flow order whose key is a member of the fold's hidden set. */
		function firstHiddenRow(container, hiddenKeys) {
			if (hiddenKeys.length === 0) return void 0;
			const hidden = new Set(hiddenKeys);
			for (const child of container.children) {
				const key = child.getAttribute("data-chat-flow-key");
				if (key !== null && hidden.has(key)) return child;
			}
		}
		//#endregion
		//#region src/client/fold-driver.ts
		/**
		* Fold driver: the orchestrator between the session snapshot, the pure fold
		* planner, and the DOM applier.
		*
		* The client entry wires the observation side (body/container mutation
		* observers, delegated header clicks, session subscriptions) and calls
		* {@link FoldDriver.run} on every change; this driver owns:
		*
		* - projecting the session snapshot into the planner's window,
		* - translating plans into DOM folds (per flow container),
		* - auto-loading older history — once, capped — when a closed turn's head
		*   sits outside the window (page-split turns must complete before folding),
		* - the per-session expanded set (reset on session switch).
		*/
		/** Project a DriverSnapshot into the planner's window, or null while not open. */
		function windowFromSnapshot(snapshot) {
			if (snapshot.openState !== "open") return null;
			const turns = /* @__PURE__ */ new Map();
			for (const [number, t] of snapshot.turns) {
				const startLoaded = t.startTime !== void 0;
				const endLoaded = t.endTime !== void 0;
				turns.set(number, {
					turn: number,
					startLoaded,
					endLoaded,
					...startLoaded && endLoaded ? { durationMs: Math.max(0, t.endTime - t.startTime) } : {}
				});
			}
			const nodes = [];
			for (const key of snapshot.order) {
				const node = snapshot.nodes.get(key);
				if (node === void 0) continue;
				nodes.push({
					key,
					kind: node.kind,
					anchorSeq: node.anchorSeq,
					turn: node.location?.turn
				});
			}
			return {
				turns,
				nodes,
				hasMore: snapshot.hasMore,
				loadingOlder: snapshot.loadingOlder
			};
		}
		const EMPTY_PLAN = {
			folds: [],
			completionRequest: null
		};
		/** Create a fold driver over one session source. */
		function createFoldDriver(source, options) {
			const maxAutoPages = options.maxAutoPages ?? 5;
			let expanded = /* @__PURE__ */ new Set();
			let currentSessionId = null;
			let olderInFlight = false;
			let autoPages = 0;
			const clean = () => {
				for (const container of options.containers()) applyFoldPlan(container, EMPTY_PLAN, expanded, options.copy);
			};
			const run = () => {
				const handle = source.current();
				if (handle === null) {
					currentSessionId = null;
					expanded = /* @__PURE__ */ new Set();
					clean();
					return;
				}
				if (handle.sessionId !== currentSessionId) {
					currentSessionId = handle.sessionId;
					expanded = /* @__PURE__ */ new Set();
				}
				const snapshot = handle.snapshot();
				if (snapshot === null) {
					clean();
					return;
				}
				const window = windowFromSnapshot(snapshot);
				const plan = window === null ? EMPTY_PLAN : planFolds(window);
				if (plan.completionRequest === null) autoPages = 0;
				for (const container of options.containers()) applyFoldPlan(container, plan, expanded, options.copy);
				if (plan.completionRequest !== null && !olderInFlight && autoPages < maxAutoPages) {
					autoPages += 1;
					olderInFlight = true;
					handle.loadOlder().finally(() => {
						olderInFlight = false;
						run();
					});
				}
			};
			const toggle = (turn) => {
				const next = new Set(expanded);
				if (next.has(turn)) next.delete(turn);
				else next.add(turn);
				expanded = next;
				const header = findFoldHeader(options.containers(), turn);
				const captured = header !== null && header.isConnected && header.parentElement !== null ? {
					header,
					top: header.getBoundingClientRect().top,
					scroller: scrollerOf(header.parentElement)
				} : null;
				run();
				if (captured !== null && captured.scroller !== null && typeof requestAnimationFrame === "function") requestAnimationFrame(() => {
					if (!captured.header.isConnected) return;
					requestAnimationFrame(() => {
						if (captured.header.isConnected) restoreHeaderPosition(captured.header, captured.top);
					});
				});
			};
			const start = () => {
				run();
				return source.subscribe(run);
			};
			return {
				run,
				toggle,
				start
			};
		}
		/** The scroll container the header moves in (the ChatView scroll column). */
		function scrollerOf(container) {
			return container.closest("[data-conversation-scroll]") ?? container.parentElement ?? null;
		}
		/**
		* Scroll the scroller back so the header returns to its captured viewport top
		* (undoing any at-bottom follow shift). Returns whether it scrolled.
		*/
		function restoreHeaderPosition(header, capturedTop) {
			const container = header.parentElement;
			if (container === null) return false;
			const scroller = scrollerOf(container);
			if (scroller === null) return false;
			const delta = header.getBoundingClientRect().top - capturedTop;
			if (delta !== 0) {
				scroller.scrollTop += delta;
				return true;
			}
			return false;
		}
		function findFoldHeader(containers, turn) {
			for (const container of containers) for (const child of container.children) {
				const el = child;
				if (el.hasAttribute("data-dsh-fold-header") && el.getAttribute("data-dsh-fold-turn") === String(turn)) return el;
			}
			return null;
		}
		//#endregion
		//#region \0dsh-css:src/client/mobile-sidebar.css.mjs
		const css$2 = "/**\n * Narrow-screen drawer for the host left sidebar (see mobile-sidebar.tsx).\n * Every rule is gated to max-width: 767px (NARROW_MAX_WIDTH in the module):\n * at ≥768px the host's native rail / wide sidebar keeps its behavior and the\n * trigger + scrim are hidden. Selectors are plugin-owned data attributes\n * plus the host frame's own `data-sidebar-collapsed` state — no hashed\n * classes, no host changes.\n */\n\n/* The trigger + scrim mount on every width but render only on phones. */\n@media (min-width: 768px) {\n  [data-dsh-mobile-sidebar-root] {\n    display: none;\n  }\n}\n\n[data-dsh-mobile-trigger] {\n  position: fixed;\n  top: max(8px, env(safe-area-inset-top, 0px));\n  left: max(8px, env(safe-area-inset-left, 0px));\n  z-index: 61;\n  width: 42px;\n  height: 42px;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  padding: 0;\n  border-radius: 12px;\n  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08));\n  background: var(--dsw-alias-button-elevated-fill, #ffffff);\n  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.14);\n  color: var(--dsw-alias-label-primary, #1a1a1a);\n  cursor: pointer;\n}\n\n[data-dsh-mobile-trigger]:hover {\n  background: var(--dsw-alias-button-floating-hover, #f0f1f3);\n}\n\n/* The better-sidebar right panel (phones collapse its two panels into\n   the one right panel) is open exactly while `body` lacks\n   data-dsh-sidebar-collapsed — that plugin mirrors its panelOpen onto\n   body. The open panel covers the whole phone viewport and the floating\n   whale trigger would hover over its top-left corner, so hide the\n   trigger in that state (it only floats above the conversation). */\nbody:not([data-dsh-sidebar-collapsed]) [data-dsh-mobile-trigger] {\n  display: none;\n}\n\n[data-dsh-mobile-scrim] {\n  position: fixed;\n  inset: 0;\n  z-index: 59;\n  /* Below the drawer (60) and the trigger (61): the drawer stays fully\n     interactive while the scrim only dims + catches clicks on the\n     conversation outside the drawer. */\n  display: none;\n  padding: 0;\n  border: 0;\n  background: rgba(0, 0, 0, 0.36);\n  cursor: pointer;\n}\n\n/* The scrim shows only while the drawer is open (mirrors the frame's\n   collapsed attribute; set by the module's attribute observer). */\n[data-dsh-mobile-sidebar-root][data-dsh-mobile-open='true'] [data-dsh-mobile-scrim] {\n  display: block;\n}\n\n/* Soft fade under the top edge: with the session header hidden the flow\n   scrolls flush to the screen edge; this translucent white gradient (the\n   page background is white) gives the top a gentle boundary — content\n   sinks beneath it as it scrolls — without blocking any interaction.\n   z-index 35: above the app's in-flow content (auto), but below the\n   better-sidebar overlay layer (data-dsh-panel-host, z 40) so the\n   panel's top buttons/sidebar are never washed out, and below the\n   scrim (59), the drawer (60) and the trigger (61). Hidden on desktop\n   together with the root. */\n[data-dsh-mobile-top-fade] {\n  position: fixed;\n  top: 0;\n  left: 0;\n  right: 0;\n  height: calc(72px + env(safe-area-inset-top, 0px));\n  z-index: 35;\n  pointer-events: none;\n  background: linear-gradient(to bottom, rgba(255, 255, 255, 0.98) 0%, rgba(255, 255, 255, 0.85) 38%, rgba(255, 255, 255, 0) 100%);\n}\n\n/* While the drawer is open the fade is redundant — the scrim dims the\n   remainder and the drawer is its own surface — and its white wash\n   covers the drawer's head controls, so hide it in that state. */\n[data-dsh-mobile-sidebar-root][data-dsh-mobile-open='true'] [data-dsh-mobile-top-fade] {\n  display: none;\n}\n\n@media (max-width: 767px) {\n  /* Zero the sidebar's grid track: the column occupies no width and the\n     conversation takes the full viewport. The frame sets its track inline,\n     so the override needs !important. */\n  [data-dsh-mobile-frame] {\n    grid-template-columns: 0 minmax(0, 1fr) 0 !important;\n  }\n\n  /* Pin every column to its own grid line. Without this, hiding the sidebar\n     column (display:none) or turning it into the fixed drawer (position:\n     fixed) removes it from the grid flow, and CSS auto-placement then shifts\n     the center column into the zero-width first track (invisible) while the\n     details column lands in the full-width middle track — the message flow\n     disappears and only the details panel shows. */\n  [data-dsh-mobile-frame] [data-dsh-mobile-sidebar-col] {\n    grid-column: 1 / 2;\n  }\n\n  [data-dsh-mobile-frame] [data-dsh-mobile-center-col] {\n    grid-column: 2 / 3;\n  }\n\n  [data-dsh-mobile-frame] [data-dsh-mobile-details-col] {\n    grid-column: 3 / 4;\n  }\n\n  /* Collapsed (rail): the column is gone entirely; only the trigger shows. */\n  [data-dsh-mobile-frame][data-sidebar-collapsed] [data-dsh-mobile-sidebar-col] {\n    display: none;\n  }\n\n  /* Expanded: the column becomes a fixed overlay drawer over the\n     conversation. */\n  /* The drawer floats ABOVE the scrim (59) — the scrim would otherwise\n     swallow every click inside the drawer (it covers the whole viewport)\n     and the sidebar would feel dead; the trigger (61) stays on top so it\n     remains the close affordance over the open drawer. */\n  [data-dsh-mobile-frame]:not([data-sidebar-collapsed]) [data-dsh-mobile-sidebar-col] {\n    position: fixed;\n    top: 0;\n    bottom: 0;\n    left: 0;\n    width: 280px;\n    z-index: 60;\n    box-shadow: 8px 0 32px rgba(0, 0, 0, 0.28);\n    transform: translateX(-100%);\n    animation: dsh-mobile-drawer-in 220ms var(--ds-ease-in-out, ease) forwards;\n  }\n\n  /* The whole session header — title crumb, mode, the \"Session log\"\n     utility and the Chat/Trajectory tabs (host wSkVaW_header, reached\n     through its display:contents slot wrapper; the slot is the stable\n     seam) — is hidden on phones: it is pure chrome, the tabs have no\n     touch context, and it frees ~76px at the top for the message flow.\n     The floating whale trigger takes over the corner. The slot carries\n     an inline `display: contents` from the host, so the override needs\n     !important. */\n  [data-slot='conversation.session.header'] {\n    display: none !important;\n  }\n\n  /* Top clearance for the trigger at the very top of the flow: padding on\n     the scroll CONTENT (not the scroller) so it scrolls away — full\n     clearance only while scrollTop is 0, a normal gap otherwise. */\n  [data-dsh-mobile-frame] [data-chat-flow] {\n    padding-top: 56px;\n  }\n}\n\n@keyframes dsh-mobile-drawer-in {\n  from {\n    transform: translateX(-100%);\n  }\n  to {\n    transform: translateX(0);\n  }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  [data-dsh-mobile-frame]:not([data-sidebar-collapsed]) [data-dsh-mobile-sidebar-col] {\n    animation: none;\n  }\n}";
		const tagId$2 = "dsh-ui-tweaks/mobile-sidebar.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$2) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-ui-tweaks";
			tag.dataset.pluginCss = tagId$2;
			tag.textContent = css$2;
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
		* `ui-tweaks` namespace dictionaries: the fold header copy.
		* Simplified Chinese is the key-set source of truth; English mirrors it.
		*/
		/** Simplified Chinese dictionary. */
		const zh = {
			"fold.header": "已处理",
			"fold.count": "{n} 条",
			"mobile.openSidebar": "打开侧边栏"
		};
		/** English dictionary (full mirror of the zh key set). */
		const en = {
			"fold.header": "Processed",
			"fold.count": "{n} items",
			"mobile.openSidebar": "Open sidebar"
		};
		//#endregion
		//#region \0dsh-css:src/client/fold.css.mjs
		const css$1 = "/**\n * dsh-ui-tweaks fold styles. Token-driven where DSH exposes them\n * (--dsw-alias-* / --dsw-font-*), with neutral fallbacks otherwise. The\n * hidden-row rule keys off the row attribute so a row only hides while it is\n * a member of a fold and not expanded — removing the attribute (plan change)\n * restores it without touching React's classes.\n */\n\n.dsh-fold-header {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  width: 100%;\n  margin: 0;\n  /* No horizontal padding so「已处理」left-aligns with the reply text below. */\n  padding: 6px 0;\n  border: none;\n  border-radius: 6px;\n  background: transparent;\n  font: var(--dsw-font-xs-13, 13px/1.5 system-ui, -apple-system, sans-serif);\n  color: var(--dsw-alias-label-secondary, #8f8d99);\n  cursor: pointer;\n  text-align: left;\n  user-select: none;\n}\n\n.dsh-fold-header:hover {\n  color: var(--dsw-alias-label-primary, #dcdae1);\n  background: var(--dsw-alias-interactive-bg-hover-solid, rgba(128, 128, 128, 0.1));\n}\n\n.dsh-fold-caret {\n  display: inline-flex;\n  flex: none;\n  font-size: 12px;\n  line-height: 1;\n  transition: transform 0.15s ease;\n}\n\n.dsh-fold-header[aria-expanded='true'] .dsh-fold-caret {\n  transform: rotate(90deg);\n}\n\n.dsh-fold-label {\n  font-weight: 600;\n}\n\n.dsh-fold-count {\n  margin-left: auto;\n  font-size: 12px;\n  color: var(--dsw-alias-label-tertiary, #6e6c78);\n}\n\n.dsh-fold-duration {\n  font-size: 12px;\n  font-variant-numeric: tabular-nums;\n  color: var(--dsw-alias-label-tertiary, #6e6c78);\n}\n\n/* Rows inside a collapsed fold are hidden; an expanded fold restores them. */\n[data-dsh-fold-row]:not([data-dsh-fold-expanded='true']) {\n  display: none !important;\n}\n\n/*\n * Expand/collapse animation (progressive enhancement): rows fade and slide\n * down into place below the「已处理」header when the fold opens, and fold back\n * up on close. Browsers without `transition-behavior: allow-discrete` fall\n * back to the instant toggle above.\n */\n@supports (transition-behavior: allow-discrete) {\n  [data-dsh-fold-row] {\n    transition:\n      opacity 0.22s ease,\n      translate 0.22s ease,\n      display 0.22s allow-discrete;\n  }\n  [data-dsh-fold-row]:not([data-dsh-fold-expanded='true']) {\n    opacity: 0;\n    translate: 0 -6px;\n  }\n  @starting-style {\n    [data-dsh-fold-row][data-dsh-fold-expanded='true'] {\n      opacity: 0;\n      translate: 0 -6px;\n    }\n  }\n}\n\n/*\n * The folded view shows only the turn's last reply — hide its Think\n * disclosure so the reasoning doesn't leak into the collapsed block.\n * Expanding the fold re-shows it (the row carries the expanded state).\n */\n[data-dsh-fold-last][data-dsh-fold-last-expanded='false'] [data-variant='think'] {\n  display: none !important;\n}";
		const tagId$1 = "dsh-ui-tweaks/fold.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-ui-tweaks";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region \0dsh-css:src/client/composer-toolbar.css.mjs
		const css = "/**\n * Narrow-screen composer toolbar: on phone viewports the input card's\n * bottom toolbar row (attach / access picker / model picker / send) has to\n * stay on one line. The host row is `flex-wrap: wrap` with a 12px gap:\n * at 320px the content area (~262px) is 2px short of the two groups, so\n * the trailing group (model + send) wraps to a second line and the card\n * grows from 42px to 82px tall. On phones we force single-line:\n * - tighten the row gap/padding so 320px fits in one line,\n * - pin the leading group (attach + access) so it never shrinks,\n * - let the trailing group shrink — its model picker already truncates\n *   with an ellipsis and still opens the full model list on tap, and the\n *   send button keeps its `flex-shrink: 0` so it always stays visible,\n * - overflow-x as a last resort for sub-320px devices, scrolling the row\n *   horizontally (scrollbar hidden).\n *\n * Selectors are the composer card's hashed classes (uV2eYG_*), stable in\n * this frozen fork; the block is gated to max-width: 767px (same\n * breakpoint as mobile-sidebar.css) so ≥768px keeps the host's native\n * wrapping behavior untouched.\n */\n@media (max-width: 767px) {\n  .uV2eYG_row {\n    flex-wrap: nowrap !important;\n    gap: 8px !important;\n    padding: 2px 6px 6px !important;\n    overflow-x: auto !important;\n    scrollbar-width: none !important;\n  }\n\n  .uV2eYG_row::-webkit-scrollbar {\n    display: none;\n  }\n\n  /* Leading group (attach + access): keep both affordances fully visible. */\n  .uV2eYG_tools {\n    flex: 0 0 auto !important;\n  }\n\n  /* Trailing group (model + send): allowed to shrink; the model picker\n     truncates instead of forcing the row to wrap. */\n  .uV2eYG_trailing {\n    flex: 0 1 auto !important;\n    min-width: 0 !important;\n  }\n}\n\n/**\n * Session stats row above the composer (host slot\n * `conversation.composer.dock`, class FJxK0a_*): the host lays five\n * `a | b` segments — turns, LLM/tool time, TTFT, token rate, token\n * usage — on one centered nowrap line (max-width 748px). On phones the\n * line overflows the dock width and reads as clipped text running off\n * the screen, and it eats valuable viewport space above the input; the\n * dock stats are redundant with the per-message hover info, so on\n * phones we hide the whole row.\n *\n * Message hover info in the action rows (class p-xYUq_*): the host\n * shows the message time (`p-xYUq_timeStart`) and the assistant-turn\n * summary `time · Ran for … · TTFT …` (`p-xYUq_timeEnd`) on hover —\n * an interaction phones don't have, and their wide text overflows the\n * narrow viewport. Hidden on phones; the action buttons stay.\n */\n@media (max-width: 767px) {\n  .FJxK0a_root {\n    display: none !important;\n  }\n\n  .p-xYUq_timeStart,\n  .p-xYUq_timeEnd {\n    display: none !important;\n  }\n}";
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
		const inject = ["sessions", "locale"];
		/** Project the runtime snapshot onto the planner's minimal window shape. */
		function projectSnapshot(snapshot) {
			const turns = /* @__PURE__ */ new Map();
			for (const [number, location] of snapshot.chat.timeline.turns) turns.set(number, {
				startTime: location.start?.time,
				endTime: location.end?.time
			});
			return {
				openState: snapshot.openState,
				hasMore: snapshot.hasMore,
				loadingOlder: snapshot.loadingOlder,
				turns,
				order: snapshot.chat.order,
				nodes: { get(key) {
					const node = snapshot.chat.nodes.get(key);
					if (node === void 0) return void 0;
					const location = node.location;
					const turn = location.kind === "turn" || location.kind === "step" ? location.turn.turn : void 0;
					return {
						kind: node.kind,
						anchorSeq: node.anchorSeq,
						location: {
							kind: location.kind,
							turn
						}
					};
				} }
			};
		}
		/**
		* The fold driver's session source over the client runtime: the current
		* selection's SessionFace (read + subscribe + loadOlder), re-subscribed when
		* the selection changes.
		*/
		function sessionSource(ctx) {
			const currentHandle = () => {
				const id = ctx.sessions.list.getSnapshot().current;
				if (id === void 0) return null;
				const session = ctx.sessions.binding(id)?.session;
				if (session === void 0) return null;
				return {
					sessionId: id,
					snapshot: () => projectSnapshot(session.getSnapshot()),
					loadOlder: () => session.loadOlder().catch(() => {})
				};
			};
			return {
				current: currentHandle,
				subscribe(fn) {
					let snapshotUnsub = null;
					const resubscribe = () => {
						snapshotUnsub?.();
						snapshotUnsub = null;
						const id = ctx.sessions.list.getSnapshot().current;
						const session = id === void 0 ? void 0 : ctx.sessions.binding(id)?.session;
						if (session !== void 0) snapshotUnsub = session.subscribe(fn);
					};
					const offList = ctx.sessions.list.subscribe(() => {
						resubscribe();
						fn();
					});
					resubscribe();
					return () => {
						snapshotUnsub?.();
						offList();
					};
				}
			};
		}
		/**
		* Mount the folding. The effect owns the whole lifecycle: creating the
		* chrome (DOM observation + click delegation) and the driver (session
		* snapshot → plan → DOM), wired together through a rAF-coalesced re-run, and
		* torn down on fiber disposal (HMR-safe).
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
			ctx.effect(() => {
				const t = ctx.locale.bind(NS);
				const copy = {
					header: () => t("fold.header"),
					count: (n) => t("fold.count", { n }),
					duration: formatDuration
				};
				const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : ((fn) => setTimeout(() => fn(performance.now()), 16));
				let scheduled = false;
				let driver;
				const schedule = () => {
					if (scheduled) return;
					scheduled = true;
					raf(() => {
						scheduled = false;
						driver.run();
					});
				};
				const chrome = createFoldChrome(schedule, (turn) => driver.toggle(turn));
				driver = createFoldDriver(sessionSource(ctx), {
					containers: () => chrome.containers(),
					copy
				});
				const offChrome = chrome.start();
				const offDriver = driver.start();
				return () => {
					offDriver();
					offChrome();
				};
			}, "dsh-ui-tweaks: fold driver");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map