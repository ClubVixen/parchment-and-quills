import { useRef, useState } from 'react';
import { api } from '../api';

/** Crop an image to a 2:3 book cover (600×900 JPEG), centred. */
export async function toCoverDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const W = 600, H = 900, target = W / H;
    let sw = img.width, sh = img.height;
    if (sw / sh > target) sw = sh * target; else sh = sw / target;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    canvas.getContext('2d')!.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, W, H);
    return canvas.toDataURL('image/jpeg', 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const COVERS = ['#2f4858', '#6b4e71', '#8a5a44', '#3d5a40', '#4a4e69', '#7d5a50', '#2b4162', '#5c4d7d'];
export const coverColor = (id: string) => COVERS[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % COVERS.length];

/** A book cover: the uploaded image, or a coloured placeholder with the title. */
export function CoverImage({ novelId, title, cover, className = '' }: { novelId: string; title: string; cover: number | null; className?: string }) {
  return cover
    ? <div className={`cover has-image ${className}`}><img src={api.coverUrl(novelId, cover)} alt={`Cover of ${title}`} /></div>
    : <div className={`cover ${className}`} style={{ background: coverColor(novelId) }}><span>{title}</span></div>;
}

/** Upload / replace / remove buttons for a cover. */
export function CoverButtons({ novelId, cover, onChange, compact = false }: { novelId: string; cover: number | null; onChange: (v: number | null) => void; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <span className="cover-buttons" onClick={(e) => e.stopPropagation()}>
      <button className={`btn ${compact ? 'tiny' : 'small'}`} disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Uploading…' : cover ? 'Change cover' : 'Add cover'}</button>
      {cover && !compact && <button className="btn small ghost danger" onClick={async () => { await api.removeCover(novelId); onChange(null); }}>Remove</button>}
      <input ref={input} type="file" accept="image/*" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        setBusy(true);
        try { onChange((await api.setCover(novelId, await toCoverDataUrl(f))).cover); } catch (err) { alert((err as Error).message); }
        setBusy(false);
      }} />
    </span>
  );
}
