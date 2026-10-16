import { useRef, useState } from 'react';
import { api } from '../api';
import { Avatar, TopNav, useApp } from '../App';

/** Resize an image file to a square JPEG data URL (center crop). */
async function toAvatar(file: File, size = 256): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const side = Math.min(img.width, img.height);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    canvas.getContext('2d')!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
    return canvas.toDataURL('image/jpeg', 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ProfilePage() {
  const { settings, setSettings } = useApp();
  const [name, setName] = useState(settings?.userName ?? '');
  const [msg, setMsg] = useState('');
  const file = useRef<HTMLInputElement>(null);
  if (!settings) return <div className="page loading">Loading…</div>;

  const save = async (patch: { userName?: string; avatar?: string }) => {
    setSettings(await api.saveSettings(patch));
    setMsg('Saved.');
  };

  return (
    <div className="page">
      <TopNav active="profile" />
      <main className="page-body">
        <h1 className="page-title">Your Profile</h1>
        <p className="page-sub">Shown in the header and on your chat messages, and used as the author name for new novels.</p>
        <div className="card form narrow profile-card">
          <div className="row profile-row">
            <div className="avatar-edit" onClick={() => file.current?.click()} title="Change picture">
              <Avatar size={96} />
              <span className="avatar-edit-hint">Change</span>
            </div>
            <div className="grow form">
              <label>Username
                <input className="input" value={name ?? ''} placeholder="Your name or pen name" onChange={(e) => { setName(e.target.value); setMsg(''); }} />
              </label>
              <div className="row">
                <button className="btn primary" onClick={() => save({ userName: name.trim() })}>Save name</button>
                <button className="btn" onClick={() => file.current?.click()}>Upload picture…</button>
                {settings.avatar && <button className="btn ghost danger" onClick={() => save({ avatar: '' })}>Remove picture</button>}
                {msg && <span className="muted small">{msg}</span>}
              </div>
            </div>
          </div>
          <input ref={file} type="file" accept="image/*" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try { await save({ avatar: await toAvatar(f) }); } catch { setMsg('That image could not be read.'); }
          }} />
          <p className="muted small">The picture is cropped to a square and stored on this computer in <code>data/settings.json</code>.</p>
        </div>
      </main>
    </div>
  );
}
