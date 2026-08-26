import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Landing level: the workspace roster. The mobile surface opens straight
 * here — no new-session homepage — and every workspace row is a thin
 * fetch from workspace.list (the roster is small; sessions are not loaded
 * until a workspace is opened).
 */
import { useEffect, useState } from 'react';
import { listWorkspaces, listDirectory, createWorkspace } from "../api.js";
import { errorText } from "./App.js";
import { ThemeToggle } from "../theme-toggle.js";
/**
 * Render the directory browser for creating a new workspace.
 */
function DirectoryBrowser({ onCancel, onPick }) {
    const [listing, setListing] = useState(undefined);
    const [error, setError] = useState(undefined);
    const [creating, setCreating] = useState(false);
    const [path, setPath] = useState(undefined);
    const [reload, setReload] = useState(0);
    useEffect(() => {
        let cancelled = false;
        setError(undefined);
        setListing(undefined);
        void listDirectory(path).then((res) => {
            if (cancelled)
                return;
            setListing(res);
        }, (reason) => {
            if (cancelled)
                return;
            setError(errorText(reason));
        });
        return () => { cancelled = true; };
    }, [path, reload]);
    const handleCreate = async () => {
        if (listing === undefined || creating)
            return;
        setCreating(true);
        setError(undefined);
        try {
            const result = await createWorkspace(listing.path);
            onPick(result.workspace);
        }
        catch (reason) {
            setCreating(false);
            setError(errorText(reason));
        }
    };
    return (_jsxs("div", { className: "mobile dir-browser", children: [_jsxs("header", { className: "mobile-header", children: [_jsx("button", { type: "button", className: "mobile-headerAction", onClick: onCancel, children: "\u8FD4\u56DE" }), _jsx("h1", { className: "mobile-title", children: "\u9009\u62E9\u76EE\u5F55" })] }), listing !== undefined && (_jsx("div", { className: "dir-crumbs", children: listing.crumbs.map((crumb, idx) => (_jsxs("span", { children: [_jsx("button", { type: "button", className: "dir-crumb", onClick: () => setPath(crumb.path), children: crumb.name || '/' }), idx < listing.crumbs.length - 1 && _jsx("span", { className: "dir-crumb-separator", children: "/" })] }, crumb.path))) })), error !== undefined ? (_jsxs("div", { className: "mobile-empty", children: [_jsx("p", { className: "mobile-error", children: error }), _jsx("button", { type: "button", className: "mobile-button", onClick: () => setReload(n => n + 1), children: "\u91CD\u8BD5" })] })) : listing === undefined ? (_jsx("div", { className: "mobile-empty", children: _jsx("p", { className: "mobile-muted", children: "\u52A0\u8F7D\u4E2D\u2026" }) })) : (_jsx("ul", { className: "mobile-list", children: listing.entries.length === 0 ? (_jsx("div", { className: "mobile-empty dir-empty", children: _jsx("p", { className: "mobile-muted", children: "\u7A7A\u76EE\u5F55" }) })) : (listing.entries.map((entry) => (_jsx("li", { children: _jsx("button", { type: "button", className: `mobile-row dir-entry ${entry.hidden ? 'dir-entry-hidden' : ''}`, onClick: () => setPath(entry.path), children: _jsx("span", { className: "mobile-rowTitle", children: entry.name }) }) }, entry.path)))) })), _jsx("div", { className: "dir-select", children: _jsx("button", { type: "button", className: "mobile-button", disabled: listing === undefined || creating, onClick: () => void handleCreate(), children: creating ? '创建中…' : '选择此目录' }) })] }));
}
/**
 * Render the workspace roster.
 * @param props - the pick action.
 * @returns the roster.
 */
export function WorkspaceView({ initialWorkspaceId, onPick }) {
    const [items, setItems] = useState(undefined);
    const [error, setError] = useState(undefined);
    // Bumped by the retry button to re-run the roster fetch effect.
    const [reload, setReload] = useState(0);
    const [isCreating, setIsCreating] = useState(false);
    useEffect(() => {
        let cancelled = false;
        void listWorkspaces().then((rows) => {
            if (cancelled)
                return;
            const target = initialWorkspaceId === undefined
                ? undefined
                : rows.find(workspace => workspace.workspaceId === initialWorkspaceId);
            if (target !== undefined) {
                onPick(target);
                return;
            }
            setItems(rows);
        }, (reason) => {
            if (cancelled)
                return;
            setError(errorText(reason));
        });
        return () => { cancelled = true; };
    }, [initialWorkspaceId, onPick, reload]);
    if (isCreating) {
        return (_jsx(DirectoryBrowser, { onCancel: () => setIsCreating(false), onPick: onPick }));
    }
    if (error !== undefined) {
        return (_jsxs("div", { className: "mobile", children: [_jsxs("header", { className: "mobile-header", children: [_jsx("h1", { className: "mobile-title", children: "\u5DE5\u4F5C\u533A" }), _jsx(ThemeToggle, {})] }), _jsxs("div", { className: "mobile-empty", children: [_jsxs("p", { className: "mobile-error", children: ["\u52A0\u8F7D\u5931\u8D25\uFF1A", error] }), _jsx("button", { type: "button", className: "mobile-button", onClick: () => { setError(undefined); setItems(undefined); setReload(n => n + 1); }, children: "\u91CD\u8BD5" })] })] }));
    }
    if (items === undefined) {
        return (_jsxs("div", { className: "mobile", children: [_jsxs("header", { className: "mobile-header", children: [_jsx("h1", { className: "mobile-title", children: "\u5DE5\u4F5C\u533A" }), _jsx(ThemeToggle, {})] }), _jsx("div", { className: "mobile-empty", children: _jsx("p", { className: "mobile-muted", children: "\u52A0\u8F7D\u4E2D\u2026" }) })] }));
    }
    return (_jsxs("div", { className: "mobile", children: [_jsxs("header", { className: "mobile-header", children: [_jsx("h1", { className: "mobile-title", children: "\u5DE5\u4F5C\u533A" }), _jsx(ThemeToggle, {})] }), items.length === 0 ? (_jsx("div", { className: "mobile-empty", children: _jsx("p", { className: "mobile-muted", children: "\u6682\u65E0\u5DE5\u4F5C\u533A" }) })) : (_jsx("ul", { className: "mobile-list", children: items.map(workspace => (_jsx("li", { children: _jsxs("button", { type: "button", className: "mobile-row", onClick: () => { onPick(workspace); }, children: [_jsx("span", { className: "mobile-rowTitle", children: workspace.title }), _jsx("span", { className: "mobile-rowMeta", children: workspace.path }), _jsx("span", { className: "mobile-chevron", children: "\u203A" })] }) }, workspace.workspaceId))) })), _jsx("div", { style: { padding: '16px' }, children: _jsx("button", { type: "button", className: "mobile-button", onClick: () => setIsCreating(true), children: "+ \u65B0\u5EFA\u5DE5\u4F5C\u533A" }) })] }));
}
