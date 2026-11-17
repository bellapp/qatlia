'use client';

/**
 * The list of panels the artisan works with: in the account when signed in,
 * on the device otherwise or while the account store cannot be reached. Read
 * and written here for the panel page (« Configuration des panneaux »).
 *
 * The loading is the atelier's own (device list first, then the account, and
 * the one-time copy of the device list into a new account).
 */
import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  createAccountPresets,
  deleteAccountPreset,
  deletePreset,
  fetchAccountPresets,
  findDuplicatePreset,
  importDevicePresetsOnce,
  loadSavedPresets,
  savePreset,
  updateAccountPreset,
  updateDevicePreset,
  type NewPanelPreset,
  type PanelPreset,
} from '@/lib/panel-presets';

export type PresetWriteError = 'DUPLICATE' | 'LIMIT' | 'FAILED';
export type PresetWriteResult = { ok: true } | { ok: false; error: PresetWriteError; existingName?: string };

export interface PanelPresetsState {
  presets: PanelPreset[];
  /** 'device' while signed out, or while the account store cannot be reached. */
  source: 'device' | 'account';
  signedIn: boolean;
  ready: boolean;
  add(preset: NewPanelPreset): Promise<PresetWriteResult>;
  update(id: string, preset: NewPanelPreset): Promise<PresetWriteResult>;
  remove(id: string): Promise<boolean>;
}

/** The device list's own cap (see savePreset): past it, a new panel is refused, never an old one dropped. */
const DEVICE_PRESET_CAP = 40;

export function usePanelPresets(): PanelPresetsState {
  const [presets, setPresets] = useState<PanelPreset[]>([]);
  const [source, setSource] = useState<'device' | 'account'>('device');
  const [signedIn, setSignedIn] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPresets(loadSavedPresets());
    (async () => {
      try {
        const { data: { user } } = await createClient().auth.getUser();
        if (cancelled || !user) return;
        setSignedIn(true);
        let account = await fetchAccountPresets();
        if (account === null) return;
        // First signed-in visit on this device: copy its presets into the
        // account so nothing saved before is lost.
        if (await importDevicePresetsOnce(user.id)) account = (await fetchAccountPresets()) ?? account;
        if (cancelled) return;
        setPresets(account);
        setSource('account');
      } catch {
        /* the device list stays in use */
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const add = useCallback(async (preset: NewPanelPreset): Promise<PresetWriteResult> => {
    const duplicate = findDuplicatePreset(preset, presets);
    if (duplicate) return { ok: false, error: 'DUPLICATE', existingName: duplicate.name };
    if (source === 'account') {
      const saved = await createAccountPresets([preset]);
      if (!saved.ok) return { ok: false, error: saved.error === 'PRESET_LIMIT' ? 'LIMIT' : 'FAILED' };
      if (saved.duplicates.length > 0) return { ok: false, error: 'DUPLICATE', existingName: saved.duplicates[0].existingName };
      setPresets((current) => [...current, ...saved.created]);
      return { ok: true };
    }
    if (loadSavedPresets().length >= DEVICE_PRESET_CAP) return { ok: false, error: 'LIMIT' };
    try {
      savePreset(preset);
    } catch {
      return { ok: false, error: 'FAILED' };
    }
    setPresets(loadSavedPresets());
    return { ok: true };
  }, [presets, source]);

  const update = useCallback(async (id: string, preset: NewPanelPreset): Promise<PresetWriteResult> => {
    const result = source === 'account' ? await updateAccountPreset(id, preset) : updateDevicePreset(id, preset);
    if (!result.ok) return result.error === 'DUPLICATE' ? { ok: false, error: 'DUPLICATE', existingName: result.existingName } : { ok: false, error: 'FAILED' };
    setPresets((current) => current.map((p) => (p.id === id ? result.preset : p)));
    return { ok: true };
  }, [source]);

  const remove = useCallback(async (id: string): Promise<boolean> => {
    if (source === 'account') {
      if (!(await deleteAccountPreset(id))) return false;
    } else {
      try {
        deletePreset(id);
      } catch {
        return false;
      }
    }
    setPresets((current) => current.filter((p) => p.id !== id));
    return true;
  }, [source]);

  return { presets, source, signedIn, ready, add, update, remove };
}
