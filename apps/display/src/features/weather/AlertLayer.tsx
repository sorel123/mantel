import { AnimatePresence, motion } from 'framer-motion';
import { EASE, STD, motionOr, useMotionPreference } from '../../app/motion';
import { formatWhen } from './format';
import { Icon } from './icons';
import { dismissAlert, useActiveAlert } from './store';
import './weather.css';

/**
 * A banner over every screen (and over Ambient) when the server pushes `weather.alert`: the
 * warning's name, how long it runs, and a Dismiss button. The server wakes the display at the
 * same time, so the banner is seen. Mounted by the shell like any other feature layer.
 */
export function WeatherAlertLayer() {
  const alert = useActiveAlert();
  const reduced = useMotionPreference();
  return (
    <AnimatePresence>
      {alert && (
        <motion.div
          key={alert.alert.id}
          className="wx-banner"
          role="alert"
          data-severity={alert.alert.severity}
          data-no-swipe
          initial={{ y: -24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -24, opacity: 0 }}
          transition={motionOr(reduced, { duration: STD, ease: EASE })}
        >
          <Icon name="alert" />
          <div className="wx-banner-text">
            <b>{alert.alert.event}</b>
            <span>
              {alert.locationName}
              {alert.alert.ends ? ` · until ${formatWhen(alert.alert.ends)}` : ''}
            </span>
            {alert.alert.description && <p>{alert.alert.description}</p>}
          </div>
          <button className="btn sm" onClick={dismissAlert}>
            Dismiss
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
