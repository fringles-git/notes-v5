/** Hidden file inputs, opened by pickFile(kind). */
import { importBackup, importFile, importTextFiles } from '../features';

const one = (fn: (f?: File) => void) => (files: File[]) => fn(files[0]);
const INPUTS = {
  image: { accept: 'image/*', onFiles: one(importFile) },
  photo: { accept: 'image/*', capture: 'environment', onFiles: one(importFile) },
  audio: { accept: 'audio/*', onFiles: one(importFile) },
  pdf: { accept: 'application/pdf', onFiles: one(importFile) },
  text: { accept: '.md,.markdown,.txt,.html,.htm,.epub,text/markdown,text/plain,text/html,application/epub+zip', multiple: true, onFiles: importTextFiles },
  folder: { directory: true, onFiles: importTextFiles },
  backup: { accept: '.json,application/json', onFiles: one(importBackup) },
} as const;
type Kind = keyof typeof INPUTS;

export const pickFile = (kind: Kind) => document.getElementById(kind + '-input')?.click();

export function FileInputs() {
  return <>{Object.entries(INPUTS).map(([k, o]) => {
    const opts = o as { accept?: string; capture?: 'environment'; multiple?: boolean; directory?: boolean; onFiles: (f: File[]) => void };
    return (
      <input key={k} type="file" id={k + '-input'} accept={opts.accept} capture={opts.capture} multiple={opts.multiple || opts.directory} hidden
        {...(opts.directory ? { webkitdirectory: '' } : {})}
        onChange={e => { const files = [...(e.target.files || [])]; e.target.value = ''; opts.onFiles(files); }} />
    );
  })}</>;
}
