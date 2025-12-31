import { kvGet, kvSet } from "./storage";
import type { Template } from "../data/starterTemplates";

const KEY = "userTemplates:v1";

export async function getUserTemplates(): Promise<Template[]> {
  return kvGet<Template[]>(KEY, []);
}

export async function saveUserTemplates(templates: Template[]): Promise<void> {
  await kvSet(KEY, templates);
}

export function makeDuplicateId(baseId: string) {
  const stamp = Date.now().toString(36);
  return `${baseId}-copy-${stamp}`;
}

export function duplicateTemplate(t: Template): Template {
  const copy: Template = {
    ...t,
    id: makeDuplicateId(t.id),
    title: `${t.title} (copy)`,
    locked: false,
  };
  return copy;
}
