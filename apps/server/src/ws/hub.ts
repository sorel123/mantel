import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WS_PATH, WsEvent, type WsEventInput } from '@mantel/shared';
import { WebSocketServer, type WebSocket } from 'ws';
import type { DeviceAuth } from '../auth.js';
import { log } from '../log.js';

const PING_MS = 25_000;

/** Fan-out of server events to every connected display. */
export class WsHub {
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly alive = new WeakSet<WebSocket>();
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly auth: DeviceAuth) {
    this.wss.on('connection', (socket) => {
      this.alive.add(socket);
      socket.on('pong', () => this.alive.add(socket));
      log.debug(`ws connected (${this.wss.clients.size})`);
    });
  }

  get size() {
    return this.wss.clients.size;
  }

  /** Validate and send one event to every display. Throws on a malformed event. */
  broadcast(event: WsEventInput): void {
    const msg = JSON.stringify(WsEvent.parse(event));
    for (const client of this.wss.clients) if (client.readyState === client.OPEN) client.send(msg);
  }

  attach(server: Server): void {
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== WS_PATH) return;
      if (!this.auth.verify(url.searchParams.get('key'))) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req));
    });
    this.timer = setInterval(() => {
      for (const client of this.wss.clients) {
        if (!this.alive.has(client)) {
          client.terminate();
          continue;
        }
        this.alive.delete(client);
        client.ping();
      }
    }, PING_MS);
    this.timer.unref();
  }

  close(): void {
    clearInterval(this.timer);
    for (const client of this.wss.clients) client.terminate();
    this.wss.close();
  }
}
