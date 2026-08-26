/**
 * Parse-time remote-channel boot patch (issue #987): the browser-half patch
 * (client/remote-channel.ts) installs when this plugin's boot entry runs,
 * but `dsh-client-connection` boots earlier and opens its event streams
 * unrewritten — on a non-loopback origin the SDK fence rejects them and the
 * workspace list never loads. The host therefore inlines this classic script
 * right after the opening <head> tag (webserver/index-inject), so the
 * fetch/WebSocket/EventSource/src rewrite is active before ANY boot entry
 * executes. The plugin's client apply later adopts the installed seat
 * (hooks + pending unpaired signal) instead of patching twice.
 *
 * The rewrite decisions are generated from REMOTE_CHANNEL_RULES, the same
 * data the browser patch consumes — the two cannot drift apart. The script
 * self-skips on loopback origins and never throws.
 * @module dsh-remote-web-ui/remote-channel-boot
 */
import { type RemoteChannelRules } from './remote-channel-rules.ts';
/**
 * Build the inline boot script. The result contains no `</script` sequence
 * (the injection contract) and installs a {@link RemoteChannelBootSeat} on
 * the window global.
 */
export declare function buildRemoteChannelBootScript(rules?: RemoteChannelRules): string;
/** The script this plugin contributes; built once from the live rules. */
export declare const REMOTE_CHANNEL_BOOT_SCRIPT: string;
//# sourceMappingURL=remote-channel-boot.d.ts.map