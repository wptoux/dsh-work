import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** Device-pairing gate for installed mobile web-app contexts with isolated storage. */
import { useState } from 'react';
import { acceptMobilePair, mobilePairPath, parseMobilePairInput } from "./pairing.js";
/** Collect a fresh desktop-issued pairing link when this client has no paired cookie. */
export function PairRequiredView({ initialError, onPaired }) {
    const [value, setValue] = useState('');
    const [error, setError] = useState(initialError);
    const [submitting, setSubmitting] = useState(false);
    const submit = async (event) => {
        event.preventDefault();
        const input = parseMobilePairInput(value);
        if (input === undefined) {
            setError('请输入有效的配对链接。');
            return;
        }
        setSubmitting(true);
        setError(undefined);
        const result = await acceptMobilePair(input.token);
        setSubmitting(false);
        if (!result.ok) {
            setError(result.message);
            return;
        }
        onPaired(mobilePairPath(input.workspaceId));
    };
    return (_jsx("main", { className: "mobile mobile-pair", "aria-labelledby": "mobile-pair-title", children: _jsxs("form", { className: "mobile-pairCard", onSubmit: (event) => { void submit(event); }, children: [_jsx("h1", { id: "mobile-pair-title", className: "mobile-title", children: "\u8BBE\u5907\u914D\u5BF9" }), _jsx("p", { className: "mobile-muted", children: "\u7C98\u8D34\u684C\u9762\u7AEF\u590D\u5236\u7684\u914D\u5BF9\u94FE\u63A5\u4EE5\u8FDE\u63A5\u6B64\u8BBE\u5907\u3002" }), _jsx("label", { className: "mobile-pairLabel", htmlFor: "mobile-pair-link", children: "\u914D\u5BF9\u94FE\u63A5" }), _jsx("input", { id: "mobile-pair-link", className: "mobile-pairInput", value: value, onChange: (event) => { setValue(event.target.value); }, autoComplete: "off", autoCapitalize: "off", spellCheck: false }), error === undefined ? null : _jsx("p", { className: "mobile-error", role: "alert", children: error }), _jsx("button", { className: "mobile-new mobile-pairSubmit", type: "submit", disabled: submitting, children: submitting ? '正在配对' : '配对' })] }) }));
}
