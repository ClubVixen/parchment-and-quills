// Prompt inputs, NovelCrafter style: an input can offer several ways to answer (dropdown options, free text,
// a scene, picked context), may accept one or several answers, and may have a default. Prompts also get the
// inputs of every component they include, so {include("Novelcrafter/AdditionalInstructions")} brings its
// "Instructions" box along.

const LEGACY = {
  text: { types: ['text'] },
  number: { types: ['dropdown', 'text'] },
  choice: { types: ['dropdown', 'text'] },
  multi: { types: ['dropdown', 'text'], mode: 'multiple' },
  context: { types: ['context'], mode: 'multiple' },
  scene: { types: ['scene', 'text'] },
};

/** Bring an input from the old one-`type` format (or a partial definition) into the current shape. */
export function normalizeInput(inp) {
  const legacy = !inp.types && LEGACY[inp.type];
  const out = { mode: 'single', required: false, options: [], ...inp, ...(legacy || {}) };
  if (!out.types?.length) out.types = ['text'];
  delete out.type;
  return out;
}

const includeRe = /\{\s*include\(\s*(["'])(.+?)\1\s*\)\s*\}/g;

/** Names of the components a prompt includes, directly or through other components. */
export function includedComponents(prompt, prompts, seen = new Set()) {
  for (const m of prompt.messages || []) {
    for (const [, , name] of m.content.matchAll(includeRe)) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const comp = findComponent(prompts, name);
      if (comp) includedComponents(comp, prompts, seen);
    }
  }
  return seen;
}

export function findComponent(prompts, name) {
  const key = String(name).trim().toLowerCase();
  const all = prompts.filter((p) => p.kind === 'component' && p.name.trim().toLowerCase() === key);
  return all.find((p) => !p.system) || all[0];
}

/** The prompt's own inputs followed by those of its included components (own inputs win on name clashes). */
export function effectiveInputs(prompt, prompts) {
  const out = (prompt.inputs || []).map(normalizeInput);
  const names = new Set(out.map((i) => i.name.toLowerCase()));
  for (const compName of includedComponents(prompt, prompts)) {
    const comp = findComponent(prompts, compName);
    for (const inp of comp?.inputs || []) {
      if (names.has(inp.name.toLowerCase())) continue;
      names.add(inp.name.toLowerCase());
      out.push(normalizeInput(inp));
    }
  }
  return out;
}

/** The value of an input: what the author entered, else its default. Multiple-answer inputs are arrays. */
export function inputValue(def, inputs) {
  let v = inputs?.[def.name];
  const empty = v == null || (Array.isArray(v) ? !v.some((x) => String(x).trim()) : !String(v).trim());
  if (empty) v = def.default ?? (def.mode === 'multiple' ? [] : '');
  if (def.mode === 'multiple') return (Array.isArray(v) ? v : [v]).map(String).filter((x) => x.trim());
  return Array.isArray(v) ? v.filter((x) => String(x).trim()).join('\n') : String(v);
}
