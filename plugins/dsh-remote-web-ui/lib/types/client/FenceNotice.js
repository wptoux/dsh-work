import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import css from './remote.module.css';
/**
 * Render the unpaired blocking page.
 * @param props - localized copy.
 * @returns the notice element.
 */
export function FenceNotice({ t, onRetry }) {
    return (_jsx("div", { className: css.fencePage, role: "dialog", "aria-modal": "true", "aria-labelledby": "remote-fence-title", children: _jsxs("main", { className: css.fenceCard, "data-dsh-plugin": "remote-web-ui", children: [_jsx("div", { className: css.fenceMark, "aria-hidden": "true", children: "\u00D7" }), _jsx("p", { className: css.fenceEyebrow, children: t('fence.unpaired.eyebrow') }), _jsx("h1", { id: "remote-fence-title", className: css.fenceTitle, children: t('fence.unpaired.title') }), _jsx("p", { className: css.fenceDetail, children: t('fence.unpaired.hint') }), _jsxs("ol", { className: css.fenceSteps, children: [_jsx("li", { children: t('fence.unpaired.stepDesktop') }), _jsx("li", { children: t('fence.unpaired.stepLink') }), _jsx("li", { children: t('fence.unpaired.stepOpen') })] }), _jsx("button", { className: css.fenceRetry, type: "button", onClick: onRetry, children: t('fence.unpaired.retry') }), _jsx("p", { className: css.fenceFootnote, children: t('fence.unpaired.footnote') })] }) }));
}
