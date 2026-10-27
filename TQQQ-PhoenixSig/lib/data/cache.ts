import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const readJsonCache = async <T>(path: string): Promise<T | null> => {
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export const writeJsonCache = async (path: string, payload: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(payload), 'utf-8');
};
