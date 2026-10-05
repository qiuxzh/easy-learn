import React from 'react';

export function Wrapper({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col h-screen overflow-hidden">{children}</div>;
}
