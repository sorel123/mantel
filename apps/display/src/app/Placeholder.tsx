import type { ReactNode } from 'react';

/** Stand-in content for a screen until its workstream lands. */
export function Placeholder({
  title,
  owner,
  children,
}: {
  title: string;
  owner: string;
  children?: ReactNode;
}) {
  return (
    <div className="placeholder card">
      <div>
        <div className="eyebrow">{owner}</div>
        <h1 className="h1" style={{ marginTop: 10 }}>
          {title}
        </h1>
        {children ?? <p>This screen arrives with its workstream.</p>}
      </div>
    </div>
  );
}
