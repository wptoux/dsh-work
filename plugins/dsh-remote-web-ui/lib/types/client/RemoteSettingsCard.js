import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The remote-control settings card: pairing security and device limits.
 * Registers into the Plugins page's `plugins.item` seat under the
 * `remote-web-ui` settings namespace (the Host entry id): the page renders
 * the summary one-liner on the card and this form on the plugin's own page.
 */
import { useEffect, useState } from 'react';
import { PluginSettingsCard, ValueField, BooleanField } from "./PluginSettingsCard.js";
import { CardForm, booleanField, numberField, textField } from "./settings-form.js";
/** Bridges the `remote-web-ui` config form onto the card's staged form. */
export class RemoteSettingsCardController {
    form;
    store;
    /** @param scope - the bound config form for the `remote-web-ui` namespace. */
    constructor(scope) {
        this.form = new CardForm(scope, [
            booleanField('enabled'),
            numberField('tokenTtlMs'),
            numberField('offlineAfterMs'),
            numberField('maxDevices'),
            numberField('idleExpireMs'),
            textField('cookieName'),
            textField('publicBaseUrl'),
            booleanField('autoTunnel'),
        ]);
        this.store = this.form.bind(() => this.projection());
    }
    projection() {
        return {
            ...this.form.shell(),
            enabled: this.form.field('enabled'),
            tokenTtlMs: this.form.field('tokenTtlMs'),
            offlineAfterMs: this.form.field('offlineAfterMs'),
            maxDevices: this.form.field('maxDevices'),
            idleExpireMs: this.form.field('idleExpireMs'),
            cookieName: this.form.field('cookieName'),
            publicBaseUrl: this.form.field('publicBaseUrl'),
            autoTunnel: this.form.field('autoTunnel'),
        };
    }
    /**
     * Build the face the card's slot registration injects.
     * @returns the card's snapshot and its form actions.
     */
    inject() {
        return { store: this.store, ...this.form.actions() };
    }
    /**
     * Release the card's scope subscription and bound stores; the slot
     * disposer calls this on teardown.
     */
    dispose() {
        this.form.dispose();
    }
}
/**
 * Render the remote-control card: the page's one-liner in the summary view,
 * the settings form in the page view.
 * @param props - the view asked for, locale copy, the card snapshot, and its form actions.
 * @returns the one-liner, or the card.
 */
export function RemoteSettingsCard(props) {
    const { t } = props;
    const [state, setState] = useState(() => props.store.getSnapshot());
    useEffect(() => props.store.subscribe(() => setState(props.store.getSnapshot())), [props.store]);
    if (props.view === 'summary')
        return t('settings.description');
    const disabled = !state.writable;
    const fieldProps = {
        overriddenLabel: t('settings.overridden'),
        resetLabel: t('settings.reset'),
        invalidLabel: t('settings.invalidNumber'),
        disabled,
    };
    return (_jsxs(PluginSettingsCard, { t: t, titleKey: "settings.title", descriptionKey: "settings.description", hideHeader: true, state: state, onSave: props.save, onDiscard: props.discard, children: [_jsx(BooleanField, { id: "settings-remote-enabled", label: t('settings.enabled'), hint: t('settings.enabledHint'), inheritLabel: t('settings.inherit'), onLabel: t('settings.on'), offLabel: t('settings.off'), ...fieldProps, ...state.enabled, onEdit: (text) => { props.edit('enabled', text); }, onReset: () => { props.resetField('enabled'); } }), _jsx(ValueField, { id: "settings-remote-token-ttl", label: t('settings.tokenTtlMs'), hint: t('settings.tokenTtlMsHint'), numeric: true, ...fieldProps, ...state.tokenTtlMs, onEdit: (text) => { props.edit('tokenTtlMs', text); }, onReset: () => { props.resetField('tokenTtlMs'); } }), _jsx(ValueField, { id: "settings-remote-offline", label: t('settings.offlineAfterMs'), hint: t('settings.offlineAfterMsHint'), numeric: true, ...fieldProps, ...state.offlineAfterMs, onEdit: (text) => { props.edit('offlineAfterMs', text); }, onReset: () => { props.resetField('offlineAfterMs'); } }), _jsx(ValueField, { id: "settings-remote-max-devices", label: t('settings.maxDevices'), hint: t('settings.maxDevicesHint'), numeric: true, ...fieldProps, ...state.maxDevices, onEdit: (text) => { props.edit('maxDevices', text); }, onReset: () => { props.resetField('maxDevices'); } }), _jsx(ValueField, { id: "settings-remote-idle-expire", label: t('settings.idleExpireMs'), hint: t('settings.idleExpireMsHint'), numeric: true, ...fieldProps, ...state.idleExpireMs, onEdit: (text) => { props.edit('idleExpireMs', text); }, onReset: () => { props.resetField('idleExpireMs'); } }), _jsx(ValueField, { id: "settings-remote-cookie", label: t('settings.cookieName'), hint: t('settings.cookieNameHint'), ...fieldProps, ...state.cookieName, onEdit: (text) => { props.edit('cookieName', text); }, onReset: () => { props.resetField('cookieName'); } }), _jsx(ValueField, { id: "settings-remote-public-base", label: t('settings.publicBaseUrl'), hint: t('settings.publicBaseUrlHint'), placeholder: "https://example.trycloudflare.com", ...fieldProps, ...state.publicBaseUrl, onEdit: (text) => { props.edit('publicBaseUrl', text); }, onReset: () => { props.resetField('publicBaseUrl'); } }), _jsx(BooleanField, { id: "settings-remote-auto-tunnel", label: t('settings.autoTunnel'), hint: t('settings.autoTunnelHint'), inheritLabel: t('settings.inherit'), onLabel: t('settings.on'), offLabel: t('settings.off'), ...fieldProps, ...state.autoTunnel, onEdit: (text) => { props.edit('autoTunnel', text); }, onReset: () => { props.resetField('autoTunnel'); } })] }));
}
