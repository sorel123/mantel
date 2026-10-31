import type { Person } from '@mantel/shared';
import type { CSSProperties } from 'react';

/** A person's initial on their colour, as in the mockup. */
export function Avatar({ person, size = 'md' }: { person: Person; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span
      className={`lav ${size}`}
      style={{ '--pc': person.color } as CSSProperties}
      title={person.name}
      aria-hidden
    >
      {person.initial}
    </span>
  );
}
