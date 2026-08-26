/**
 * Loopback-shaped reverse proxy used by the remote desktop channel: after
 * the pairing cookie gate, traffic is re-issued to 127.0.0.1 so sibling
 * plugin fences (socket + Host loopback) accept it. Origin, cookies, and
 * caller-controlled Sec-Fetch markers are dropped. HTTP requests receive a
 * synthetic same-origin marker after the pairing gate so sibling loopback
 * routes that require a browser tripwire accept the authenticated proxy.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
/**
 * Pipe one HTTP request to loopback and stream the response back.
 * @param req - the already-gated outer request.
 * @param res - the outer response.
 * @param port - local webServer port.
 * @param upstreamPath - path + query on 127.0.0.1 (must start with `/`).
 */
export declare function proxyLoopbackHttp(req: IncomingMessage, res: ServerResponse, port: number, upstreamPath: string): void;
/**
 * Rebuild a WebSocket handshake as loopback-shaped and pipe both directions.
 * @param req - the already-gated upgrade request.
 * @param socket - the client duplex.
 * @param head - bytes already read past the handshake.
 * @param port - local webServer port.
 * @param upstreamPath - path + query on 127.0.0.1.
 */
export declare function proxyLoopbackUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, port: number, upstreamPath: string): void;
//# sourceMappingURL=loopback-proxy.d.ts.map