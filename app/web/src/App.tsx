import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';
import type { Prompt, Settings } from './types';
import { Library } from './views/Library';
import { Workspace } from './views/Workspace';
import { PromptsPage } from './views/PromptsPage';
import { SettingsPage } from './views/SettingsPage';
import { ProfilePage } from './views/ProfilePage';

export const APP_NAME = 'Parchment & Quills';

type AppState = {
  prompts: Prompt[];
  reloadPrompts: () => Promise<void>;
  settings: Settings | null;
  setSettings: (s: Settings) => void;
};
const Ctx = createContext<AppState>(null!);
export const useApp = () => useContext(Ctx);

export function navigate(hash: string) {
  window.location.hash = hash;
}

function useHash() {
  const [hash, setHash] = useState(() => window.location.hash.slice(1) || '/');
  useEffect(() => {
    const on = () => setHash(window.location.hash.slice(1) || '/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export type Mode = 'plan' | 'write' | 'read' | 'chat';

export function App() {
  const hash = useHash();
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const reloadPrompts = useCallback(async () => setPrompts(await api.prompts()), []);

  useEffect(() => {
    reloadPrompts();
    api.settings().then(setSettings);
  }, [reloadPrompts]);

  const parts = hash.split('/').filter(Boolean);
  let page;
  if (parts[0] === 'novel' && parts[1]) page = <Workspace key={parts[1]} novelId={parts[1]} mode={(parts[2] as Mode) || 'plan'} />;
  else if (parts[0] === 'prompts') page = <PromptsPage selected={parts[1]} />;
  else if (parts[0] === 'settings') page = <SettingsPage />;
  else if (parts[0] === 'profile') page = <ProfilePage />;
  else page = <Library />;

  return <Ctx.Provider value={{ prompts, reloadPrompts, settings, setSettings }}>{page}</Ctx.Provider>;
}

export function TopNav({ active }: { active: 'novels' | 'prompts' | 'settings' | 'profile' }) {
  const { settings } = useApp();
  return (
    <header className="topnav">
      <a className="brand" href="#/"><QuillIcon /> {APP_NAME}</a>
      <nav>
        <a className={active === 'novels' ? 'pill active' : 'pill'} href="#/">Novels</a>
        <a className={active === 'prompts' ? 'pill active' : 'pill'} href="#/prompts">Prompts</a>
        <a className={active === 'settings' ? 'pill active' : 'pill'} href="#/settings">AI Connection</a>
      </nav>
      <div className="topnav-right muted small">{settings ? `${settings.model} · ${settings.baseUrl.replace(/^https?:\/\//, '')}` : ''}</div>
      <a href="#/profile" className={`profile-link ${active === 'profile' ? 'active' : ''}`} title="Your profile">
        <Avatar size={34} />
        <span className="small">{settings?.userName || 'Profile'}</span>
      </a>
    </header>
  );
}

/** The user's profile picture, or their initials. */
export function Avatar({ size = 32 }: { size?: number }) {
  const { settings } = useApp();
  const name = settings?.userName?.trim() || '';
  const initials = name ? name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() : '✒';
  return settings?.avatar
    ? <img className="avatar-img" src={settings.avatar} alt={name || 'Profile'} style={{ width: size, height: size }} />
    : <span className="avatar-img initials" style={{ width: size, height: size, fontSize: size * 0.4 }}>{initials}</span>;
}

export function QuillIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20.5 3.5c-6.5.5-11 4.5-13 11l-1 3" />
      <path d="M20.5 3.5c-.5 5-3.5 9-9 10.5" />
      <path d="M9.5 11.5c2-1.5 4.5-3 7-4" />
      <path d="M6.5 17.5 4 20" />
      <path d="M3 21h8" />
    </svg>
  );
}
