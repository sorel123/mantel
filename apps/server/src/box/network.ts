/**
 * The box's network, through NetworkManager on the system D-Bus (Mantel OS ships the
 * network-manager snap; the Mantel snap's `network-manager` plug lets us talk to it).
 *
 * `FakeNetwork` stands in for tests and for `MANTEL_BOX=fake` development on a laptop.
 */
import type * as DbusNext from 'dbus-next';
import { log } from '../log.js';

export interface WifiNetwork {
  ssid: string;
  /** 0 to 100. */
  strength: number;
  secure: boolean;
}

export interface NetworkStatus {
  /** NetworkManager answered (false off Mantel OS, or when the plug is not connected). */
  available: boolean;
  online: boolean;
  kind: 'ethernet' | 'wifi' | null;
  ssid: string | null;
  address: string | null;
  hasWifi: boolean;
  hotspot: boolean;
}

export interface BoxNetwork {
  status(): Promise<NetworkStatus>;
  scan(): Promise<WifiNetwork[]>;
  connect(ssid: string, password: string | null): Promise<void>;
  startHotspot(ssid: string, password: string): Promise<void>;
  stopHotspot(): Promise<void>;
}

const NM = 'org.freedesktop.NetworkManager';
const NM_PATH = '/org/freedesktop/NetworkManager';
const PROPS = 'org.freedesktop.DBus.Properties';
const DEVICE_ETHERNET = 1;
const DEVICE_WIFI = 2;
const DEVICE_ACTIVATED = 100;
const NM_STATE_CONNECTED_SITE = 60;
export const HOTSPOT_ID = 'Mantel setup';

type DbusModule = typeof DbusNext;
// The D-Bus proxy objects are loosely typed; keep the casts in this file.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Iface = any;

export class NetworkManagerNetwork implements BoxNetwork {
  private dbus: DbusModule | null = null;
  private bus: any = null;

  private async connectBus() {
    if (this.bus) return this.bus;
    this.dbus = await import('dbus-next');
    this.bus = this.dbus.systemBus();
    this.bus.on?.('error', (err: unknown) => {
      log.warn('box: D-Bus error', { err: String(err) });
      this.bus = null;
    });
    return this.bus;
  }

  private async iface(path: string, name: string): Promise<Iface> {
    const bus = await this.connectBus();
    const obj = await bus.getProxyObject(NM, path);
    return obj.getInterface(name);
  }

  private async prop(path: string, iface: string, name: string): Promise<any> {
    const p = await this.iface(path, PROPS);
    const v = await p.Get(iface, name);
    return v?.value;
  }

  private async devices(): Promise<{ path: string; type: number; state: number }[]> {
    const nm = await this.iface(NM_PATH, NM);
    const paths: string[] = await nm.GetDevices();
    return Promise.all(
      paths.map(async (path) => ({
        path,
        type: Number(await this.prop(path, `${NM}.Device`, 'DeviceType')),
        state: Number(await this.prop(path, `${NM}.Device`, 'State')),
      })),
    );
  }

  private async wifiDevice(): Promise<string | null> {
    const d = (await this.devices()).find((x) => x.type === DEVICE_WIFI);
    return d?.path ?? null;
  }

  private async address(device: string): Promise<string | null> {
    const ip4: string = await this.prop(device, `${NM}.Device`, 'Ip4Config');
    if (!ip4 || ip4 === '/') return null;
    const data: any[] = await this.prop(ip4, `${NM}.IP4Config`, 'AddressData');
    return (data?.[0]?.address?.value as string | undefined) ?? null;
  }

  private async activeSsid(device: string): Promise<string | null> {
    const ap: string = await this.prop(device, `${NM}.Device.Wireless`, 'ActiveAccessPoint');
    if (!ap || ap === '/') return null;
    const raw: Buffer = await this.prop(ap, `${NM}.AccessPoint`, 'Ssid');
    return raw ? Buffer.from(raw).toString('utf8') : null;
  }

  private async hotspotActive(): Promise<boolean> {
    const active: string[] = await this.prop(NM_PATH, NM, 'ActiveConnections');
    for (const path of active ?? []) {
      const id: string = await this.prop(path, `${NM}.Connection.Active`, 'Id');
      if (id === HOTSPOT_ID) return true;
    }
    return false;
  }

  async status(): Promise<NetworkStatus> {
    const none: NetworkStatus = {
      available: false,
      online: false,
      kind: null,
      ssid: null,
      address: null,
      hasWifi: false,
      hotspot: false,
    };
    try {
      const devices = await this.devices();
      const state = Number(await this.prop(NM_PATH, NM, 'State'));
      const hotspot = await this.hotspotActive();
      const hasWifi = devices.some((d) => d.type === DEVICE_WIFI);
      const up = devices.filter(
        (d) =>
          d.state === DEVICE_ACTIVATED && (d.type === DEVICE_ETHERNET || d.type === DEVICE_WIFI),
      );
      const eth = up.find((d) => d.type === DEVICE_ETHERNET);
      const wifi = hotspot ? undefined : up.find((d) => d.type === DEVICE_WIFI);
      const main = eth ?? wifi;
      return {
        available: true,
        online: !hotspot && state >= NM_STATE_CONNECTED_SITE && !!main,
        kind: eth ? 'ethernet' : wifi ? 'wifi' : null,
        ssid: wifi ? await this.activeSsid(wifi.path) : null,
        address: main ? await this.address(main.path) : null,
        hasWifi,
        hotspot,
      };
    } catch (err) {
      log.debug('box: NetworkManager unavailable', { err: String(err) });
      return none;
    }
  }

  async scan(): Promise<WifiNetwork[]> {
    const dev = await this.wifiDevice();
    if (!dev) return [];
    const wl = await this.iface(dev, `${NM}.Device.Wireless`);
    try {
      await wl.RequestScan({});
      await new Promise((r) => setTimeout(r, 4000));
    } catch {
      /* a scan already running, or the radio is in hotspot mode: use what NetworkManager has */
    }
    const aps: string[] = await wl.GetAllAccessPoints();
    const best = new Map<string, WifiNetwork>();
    for (const ap of aps) {
      const ifc = `${NM}.AccessPoint`;
      const raw: Buffer = await this.prop(ap, ifc, 'Ssid');
      const ssid = raw ? Buffer.from(raw).toString('utf8') : '';
      if (!ssid || ssid === HOTSPOT_ID) continue;
      const strength = Number(await this.prop(ap, ifc, 'Strength'));
      const secure =
        Number(await this.prop(ap, ifc, 'WpaFlags')) !== 0 ||
        Number(await this.prop(ap, ifc, 'RsnFlags')) !== 0 ||
        (Number(await this.prop(ap, ifc, 'Flags')) & 1) === 1;
      const prev = best.get(ssid);
      if (!prev || prev.strength < strength) best.set(ssid, { ssid, strength, secure });
    }
    return [...best.values()].sort((a, b) => b.strength - a.strength);
  }

  private settings(d: DbusModule, sections: Record<string, Record<string, [string, unknown]>>) {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [section, values] of Object.entries(sections)) {
      out[section] = {};
      for (const [k, [sig, v]] of Object.entries(values)) out[section]![k] = new d.Variant(sig, v);
    }
    return out;
  }

  private async removeConnections(id: string) {
    const s = await this.iface(`${NM_PATH}/Settings`, `${NM}.Settings`);
    const paths: string[] = await s.ListConnections();
    for (const path of paths) {
      const c = await this.iface(path, `${NM}.Settings.Connection`);
      const settings = await c.GetSettings();
      if (settings?.connection?.id?.value === id) await c.Delete();
    }
  }

  async connect(ssid: string, password: string | null): Promise<void> {
    await this.connectBus();
    const d = this.dbus!;
    const dev = await this.wifiDevice();
    if (!dev) throw new Error('this box has no Wi-Fi');
    await this.stopHotspot();
    await this.removeConnections(ssid);
    const nm = await this.iface(NM_PATH, NM);
    const sections: Record<string, Record<string, [string, unknown]>> = {
      connection: {
        id: ['s', ssid],
        type: ['s', '802-11-wireless'],
        autoconnect: ['b', true],
      },
      '802-11-wireless': { ssid: ['ay', Buffer.from(ssid, 'utf8')], mode: ['s', 'infrastructure'] },
      ipv4: { method: ['s', 'auto'] },
      ipv6: { method: ['s', 'auto'] },
    };
    if (password)
      sections['802-11-wireless-security'] = { 'key-mgmt': ['s', 'wpa-psk'], psk: ['s', password] };
    await nm.AddAndActivateConnection(this.settings(d, sections), dev, '/');
  }

  async startHotspot(ssid: string, password: string): Promise<void> {
    await this.connectBus();
    const d = this.dbus!;
    const dev = await this.wifiDevice();
    if (!dev) throw new Error('this box has no Wi-Fi');
    await this.removeConnections(HOTSPOT_ID);
    const nm = await this.iface(NM_PATH, NM);
    await nm.AddAndActivateConnection(
      this.settings(d, {
        connection: {
          id: ['s', HOTSPOT_ID],
          type: ['s', '802-11-wireless'],
          autoconnect: ['b', false],
        },
        '802-11-wireless': {
          ssid: ['ay', Buffer.from(ssid, 'utf8')],
          mode: ['s', 'ap'],
          band: ['s', 'bg'],
        },
        '802-11-wireless-security': {
          'key-mgmt': ['s', 'wpa-psk'],
          psk: ['s', password],
          proto: ['as', ['rsn']],
          pairwise: ['as', ['ccmp']],
          group: ['as', ['ccmp']],
        },
        ipv4: { method: ['s', 'shared'] },
        ipv6: { method: ['s', 'ignore'] },
      }),
      dev,
      '/',
    );
  }

  async stopHotspot(): Promise<void> {
    try {
      await this.removeConnections(HOTSPOT_ID);
    } catch (err) {
      log.debug('box: could not remove the setup hotspot', { err: String(err) });
    }
  }
}

/** A pretend network for tests and laptop development. */
export class FakeNetwork implements BoxNetwork {
  state: NetworkStatus = {
    available: true,
    online: false,
    kind: null,
    ssid: null,
    address: null,
    hasWifi: true,
    hotspot: false,
  };
  networks: WifiNetwork[] = [
    { ssid: 'Home', strength: 82, secure: true },
    { ssid: 'Neighbours', strength: 40, secure: true },
    { ssid: 'Cafe guest', strength: 22, secure: false },
  ];
  /** The password FakeNetwork accepts for secured networks. */
  password = 'correct horse';

  async status() {
    return { ...this.state };
  }
  async scan() {
    return [...this.networks];
  }
  async connect(ssid: string, password: string | null) {
    const n = this.networks.find((x) => x.ssid === ssid);
    if (!n) throw new Error(`no network called ${ssid}`);
    if (n.secure && password !== this.password) throw new Error('wrong password');
    this.state = {
      ...this.state,
      online: true,
      kind: 'wifi',
      ssid,
      address: '192.168.1.50',
      hotspot: false,
    };
  }
  async startHotspot() {
    this.state = { ...this.state, hotspot: true, online: false, address: '10.42.0.1' };
  }
  async stopHotspot() {
    if (this.state.hotspot) this.state = { ...this.state, hotspot: false, address: null };
  }
}
