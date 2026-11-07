import type { PluginAlertPayload } from '@mantel/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { EASE, STD, motionOr, useMotionPreference } from '../../app/motion';
import { useServerEvent } from '../../lib/events';
import { useRunAction } from './Blocks';
import { startChime, stopChime } from './chime';
import { PluginIcon } from './icons';
import './plugins.css';

/**
 * Banners for `plugin.alert` (a kitchen timer rang), over every screen and Ambient, with the
 * plugin's buttons and Dismiss, and a chime while any of them asked for one. A banner closes
 * when someone presses a button here, or when the plugin says it no longer applies (stopped
 * on another display). Mounted by the shell's feature layers.
 */
export function PluginAlertLayer() {
  const [alerts, setAlerts] = useState<PluginAlertPayload[]>([]);
  const reduced = useMotionPreference();

  const onAlert = (a: PluginAlertPayload) =>
    setAlerts((list) => [...list.filter((x) => !(x.id === a.id && x.key === a.key)), a]);
  useServerEvent('plugin.alert', onAlert);
  const onChanged = ({ id, cleared }: { id: string; cleared?: string[] | undefined }) => {
    if (cleared?.length)
      setAlerts((list) => list.filter((x) => !(x.id === id && cleared.includes(x.key))));
  };
  useServerEvent('plugin.changed', onChanged);

  const chiming = alerts.some((a) => a.chime);
  useEffect(() => {
    if (chiming) startChime();
    else stopChime();
  }, [chiming]);
  useEffect(() => stopChime, []);

  const close = (a: PluginAlertPayload) =>
    setAlerts((list) => list.filter((x) => !(x.id === a.id && x.key === a.key)));

  return (
    <div className="plugin-alerts" data-no-swipe>
      <AnimatePresence>
        {alerts.map((a) => (
          <motion.div
            key={`${a.id}:${a.key}`}
            className="plugin-banner"
            role="alert"
            layout
            initial={{ y: -24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -24, opacity: 0 }}
            transition={motionOr(reduced, { duration: STD, ease: EASE })}
            // Taps here must not fall through and wake or change the screen underneath.
            onPointerDown={(e) => e.stopPropagation()}
          >
            <PluginIcon name={a.icon ?? 'bell'} />
            <div className="plugin-banner-text">
              <b>{a.title}</b>
              {a.text && <span>{a.text}</span>}
            </div>
            <Buttons alert={a} onDone={() => close(a)} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function Buttons({ alert, onDone }: { alert: PluginAlertPayload; onDone: () => void }) {
  const { run, busy } = useRunAction(alert.id);
  return (
    <div className="plugin-banner-acts">
      {alert.actions.map((a, i) => (
        <button
          key={i}
          type="button"
          className={`btn${a.tone === 'primary' ? ' primary' : ''}`}
          disabled={busy !== null}
          onClick={() => void run(String(i), a.name, a.args).then(onDone)}
        >
          {a.label}
        </button>
      ))}
      {!alert.actions.length && (
        <button type="button" className="btn primary" onClick={onDone}>
          Dismiss
        </button>
      )}
    </div>
  );
}
