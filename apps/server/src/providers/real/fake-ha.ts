/**
 * A fake Home Assistant for tests: the WebSocket API (auth, states, registries, events,
 * service calls, ping) and the camera and artwork REST endpoints, all in memory.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import type { HaRegistry, HaState } from './home-client.js';

export interface ServiceCall {
  domain: string;
  service: string;
  service_data: Record<string, unknown>;
  target?: { entity_id: string | string[] };
}

export const TOKEN = 'test-token';

export class FakeHa {
  readonly states = new Map<string, HaState>();
  readonly calls: ServiceCall[] = [];
  registry: HaRegistry = { areas: [], entities: [], devices: [] };
  /** Applied to the state when a service is called; return null to leave the state alone. */
  onCall: (call: ServiceCall) => Partial<HaState> | null = () => null;
  /** Make the next calls fail with this message. */
  failCalls: string | null = null;
  answerPings = true;
  connections = 0;
  url = '';
  private server: Server;
  private wss: WebSocketServer;
  private subs = new Map<WebSocket, number>();

  constructor() {
    this.server = createServer((req, res) => {
      if (req.headers.authorization !== `Bearer ${TOKEN}`) {
        res.writeHead(401).end();
        return;
      }
      const url = req.url ?? '';
      const snap = url.match(/^\/api\/camera_proxy\/(camera\.\w+)/);
      if (snap) {
        res.writeHead(200, { 'content-type': 'image/jpeg' }).end(`jpeg:${snap[1]}`);
        return;
      }
      const stream = url.match(/^\/api\/camera_proxy_stream\/(camera\.\w+)/);
      if (stream) {
        res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace;boundary=frame' });
        res.write('--frame\r\nContent-Type: image/jpeg\r\n\r\nframe1\r\n');
        const t = setInterval(
          () => res.write('--frame\r\nContent-Type: image/jpeg\r\n\r\nframe\r\n'),
          20,
        );
        req.on('close', () => clearInterval(t));
        return;
      }
      if (url.startsWith('/api/media_player_proxy/')) {
        res.writeHead(200, { 'content-type': 'image/png' }).end('png');
        return;
      }
      res.writeHead(404).end();
    });
    this.wss = new WebSocketServer({ server: this.server, path: '/api/websocket' });
    this.wss.on('connection', (ws) => this.onConnection(ws));
  }

  async listen(): Promise<string> {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this.url;
  }

  async close() {
    for (const c of this.wss.clients) c.terminate();
    this.wss.close();
    await new Promise((r) => this.server.close(r));
  }

  /** Drop every client connection, as an HA restart would. */
  dropAll() {
    for (const c of this.wss.clients) c.terminate();
  }

  set(entityId: string, state: string, attributes: Record<string, unknown> = {}, emit = true) {
    const prev = this.states.get(entityId) ?? null;
    const at = new Date().toISOString();
    const next: HaState = {
      entity_id: entityId,
      state,
      attributes: { ...(prev?.attributes ?? {}), ...attributes },
      last_changed: prev && prev.state === state ? prev.last_changed : at,
      last_updated: at,
    };
    this.states.set(entityId, next);
    if (emit) this.broadcast(entityId, next, prev);
    return next;
  }

  private broadcast(entityId: string, next: HaState | null, prev: HaState | null) {
    for (const [ws, id] of this.subs)
      ws.send(
        JSON.stringify({
          id,
          type: 'event',
          event: {
            event_type: 'state_changed',
            data: { entity_id: entityId, new_state: next, old_state: prev },
          },
        }),
      );
  }

  private onConnection(ws: WebSocket) {
    this.connections++;
    let authed = false;
    ws.send(JSON.stringify({ type: 'auth_required', ha_version: '2026.10.0' }));
    ws.on('close', () => this.subs.delete(ws));
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as Record<string, unknown> & { id: number; type: string };
      if (!authed) {
        if (msg.type === 'auth' && msg.access_token === TOKEN) {
          authed = true;
          ws.send(JSON.stringify({ type: 'auth_ok' }));
        } else {
          ws.send(JSON.stringify({ type: 'auth_invalid', message: 'bad token' }));
          ws.close();
        }
        return;
      }
      const ok = (result: unknown = null) =>
        ws.send(JSON.stringify({ id: msg.id, type: 'result', success: true, result }));
      switch (msg.type) {
        case 'ping':
          if (this.answerPings) ws.send(JSON.stringify({ id: msg.id, type: 'pong' }));
          return;
        case 'subscribe_events':
          this.subs.set(ws, msg.id);
          return ok();
        case 'get_states':
          return ok([...this.states.values()]);
        case 'get_config':
          return ok({ unit_system: { temperature: '°F' } });
        case 'config/area_registry/list':
          return ok(this.registry.areas);
        case 'config/entity_registry/list':
          return ok(this.registry.entities);
        case 'config/device_registry/list':
          return ok(this.registry.devices);
        case 'call_service': {
          const call = msg as unknown as ServiceCall;
          this.calls.push(call);
          if (this.failCalls) {
            ws.send(
              JSON.stringify({
                id: msg.id,
                type: 'result',
                success: false,
                error: { code: 'home_assistant_error', message: this.failCalls },
              }),
            );
            return;
          }
          ok({ context: {} });
          const ids = call.target?.entity_id;
          for (const id of Array.isArray(ids) ? ids : ids ? [ids] : []) {
            const patch = this.onCall(call);
            if (patch)
              this.set(
                id,
                patch.state ?? this.states.get(id)?.state ?? 'unknown',
                patch.attributes,
              );
          }
          return;
        }
        default:
          ws.send(
            JSON.stringify({
              id: msg.id,
              type: 'result',
              success: false,
              error: { code: 'unknown_command', message: msg.type },
            }),
          );
      }
    });
  }
}
