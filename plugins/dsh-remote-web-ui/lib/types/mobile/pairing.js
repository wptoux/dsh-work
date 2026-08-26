const MOBILE_ROOT = '/m/';
/** Parse a pairing token or a copied pairing link without following its origin. */
export function parseMobilePairInput(value) {
    const trimmed = value.trim();
    if (trimmed === '')
        return undefined;
    try {
        const url = new URL(trimmed);
        const token = url.searchParams.get('pair');
        if (token === null || token === '')
            return undefined;
        const workspaceId = url.searchParams.get('workspace');
        return {
            token,
            ...(workspaceId !== null && workspaceId !== '' ? { workspaceId } : {}),
        };
    }
    catch {
        return { token: trimmed };
    }
}
/** Build the safe, token-free mobile destination after successful pairing. */
export function mobilePairPath(workspaceId) {
    return workspaceId === undefined ? MOBILE_ROOT : MOBILE_ROOT + '?workspace=' + encodeURIComponent(workspaceId);
}
/** Accept one pairing token on this exact browser or installed-web-app context. */
export async function acceptMobilePair(token, fetcher = fetch) {
    try {
        const response = await fetcher('/api/pair/accept', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token }),
        });
        if (response.ok)
            return { ok: true };
        if (response.status === 404)
            return { ok: false, message: '配对链接无效或已过期。' };
        if (response.status === 409)
            return { ok: false, message: '配对链接已被使用。' };
        return { ok: false, message: '此设备无法使用该配对链接。' };
    }
    catch {
        return { ok: false, message: '无法连接到配对服务。' };
    }
}
/** Consume a QR pairing token before the mobile application starts making RPC calls. */
export async function consumeMobilePairUrl(href, fetcher = fetch) {
    let url;
    try {
        url = new URL(href);
    }
    catch {
        return { kind: 'none' };
    }
    const token = url.searchParams.get('pair');
    if (token === null || token === '')
        return { kind: 'none' };
    const workspaceId = url.searchParams.get('workspace');
    const path = mobilePairPath(workspaceId === null || workspaceId === '' ? undefined : workspaceId);
    const result = await acceptMobilePair(token, fetcher);
    return result.ok ? { kind: 'accepted', path } : { kind: 'failed', path, message: result.message };
}
