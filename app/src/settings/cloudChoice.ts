import type { SelectOption } from "./Controls";

/** A model that can speak, with the voices it offers. */
export interface CloudModel {
  id: string;
  voices: string[];
}

/** A provider the catalog lists with a speech capability. */
export interface CloudProvider {
  id: string;
  name: string;
  configured: boolean;
  models: CloudModel[];
}

/** The saved voice: provider, model and voice. An empty voice takes the model's default. */
export interface CloudChoice {
  provider: string;
  model: string;
  voice: string;
}

export const NO_CHOICE: CloudChoice = { provider: "", model: "", voice: "" };

/** Providers the user can speak through: a key is set and the catalog lists at least one model. */
export function usableProviders(providers: CloudProvider[]): CloudProvider[] {
  return providers.filter((provider) => provider.configured && provider.models.length > 0);
}

/** The option id of one model. Provider ids never contain a bar, so the first bar splits it back. */
export function modelKey(provider: string, model: string): string {
  return `${provider}|${model}`;
}

export function splitModelKey(key: string): { provider: string; model: string } {
  const at = key.indexOf("|");
  return at < 0 ? { provider: key, model: "" } : { provider: key.slice(0, at), model: key.slice(at + 1) };
}

/** The choice that is used. A saved provider or model that is no longer listed falls back to the first usable
 * one, and a voice the model does not offer becomes the default. Saves from before the model field existed have
 * no model, so they take the provider's first, and their free-text voice names survive only when listed. */
export function resolveChoice(providers: CloudProvider[], saved: CloudChoice): CloudChoice {
  const usable = usableProviders(providers);
  const provider = usable.find((candidate) => candidate.id === saved.provider) ?? usable[0];
  if (!provider) return NO_CHOICE;
  const model = provider.models.find((candidate) => candidate.id === saved.model) ?? provider.models[0];
  const voice = model.voices.includes(saved.voice) ? saved.voice : "";
  return { provider: provider.id, model: model.id, voice };
}

/** Model options grouped by provider. Names only; voices come from the second select. */
export function modelOptions(providers: CloudProvider[]): SelectOption[] {
  return usableProviders(providers).flatMap((provider) =>
    provider.models.map((model) => ({
      id: modelKey(provider.id, model.id),
      label: model.id,
      group: provider.name,
      groupType: provider.id,
    })),
  );
}

/** Voice options for the chosen model. The first is the model's default. */
export function voiceOptions(providers: CloudProvider[], choice: CloudChoice, automatic: string): SelectOption[] {
  const model = usableProviders(providers)
    .find((provider) => provider.id === choice.provider)
    ?.models.find((candidate) => candidate.id === choice.model);
  return [
    { id: "", label: automatic },
    ...(model?.voices ?? []).map((voice) => ({ id: voice, label: voice })),
  ];
}
